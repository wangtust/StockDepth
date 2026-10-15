#!/usr/bin/env python3
"""Replace a dedicated remote backup database from a consistent local dump.

Credentials stay in subprocess environments. Direct remote connections require
verified TLS; an optional verified SSH tunnel provides transport encryption.
"""
import argparse
import contextlib
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import sys
import time
from urllib.parse import parse_qs, unquote, urlsplit
from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parents[1]
SCHEMAS_SQL = "select nspname from pg_namespace where nspname not like 'pg_%' and nspname <> 'information_schema' order by nspname"
TABLES_SQL = "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname not like 'pg_%' and n.nspname <> 'information_schema' and c.relkind in ('r','p')"


def command(args, env=None):
    result = subprocess.run(args, env=env, capture_output=True, text=True)
    if result.returncode:
        # SQL errors can include data from constraints. Keep logs credential/data free.
        raise RuntimeError(f'{Path(args[0]).name} failed (exit {result.returncode})')
    return result.stdout


def query(env, sql):
    return command(['psql', '-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1', '-c', sql], env).strip()


def source_environment(config):
    url = urlsplit(config['POSTGRES_URL'])
    if url.scheme not in ('postgres', 'postgresql') or not url.hostname or not url.path.strip('/'):
        raise ValueError('Invalid POSTGRES_URL')
    params = parse_qs(url.query)
    env = os.environ.copy()
    for key in ('PGHOSTADDR', 'PGSERVICE', 'PGSERVICEFILE'):
        env.pop(key, None)
    env.update(PGHOST=url.hostname, PGPORT=str(url.port or 5432), PGDATABASE=unquote(url.path[1:]),
               PGUSER=unquote(url.username or ''), PGPASSWORD=unquote(url.password or ''),
               PGCONNECT_TIMEOUT='10', PGSSLMODE=params.get('sslmode', ['prefer'])[0])
    for key, value in [('sslrootcert', 'PGSSLROOTCERT'), ('sslcert', 'PGSSLCERT'), ('sslkey', 'PGSSLKEY')]:
        if key in params:
            env[value] = params[key][0]
    return env


@contextlib.contextmanager
def target_environment(config, source):
    host = config.get('DATABASE_SYNC_HOST')
    if not host:
        raise ValueError('Configure DATABASE_SYNC_HOST first')
    env = source.copy()
    env.update(PGHOST=host, PGPORT=config.get('DATABASE_SYNC_PORT', '5432'),
               PGDATABASE=config.get('DATABASE_SYNC_DATABASE', 'stockdepth'), PGSSLMODE='verify-full')
    for key in ('PGSSLROOTCERT', 'PGSSLCERT', 'PGSSLKEY'):
        env.pop(key, None)
    if config.get('DATABASE_SYNC_SSLROOTCERT'):
        env['PGSSLROOTCERT'] = config['DATABASE_SYNC_SSLROOTCERT']
    ssh_user = config.get('DATABASE_SYNC_SSH_USER')
    if not ssh_user:
        if (env['PGHOST'], env['PGPORT'], env['PGDATABASE']) == (source['PGHOST'], source['PGPORT'], source['PGDATABASE']):
            raise ValueError('Source and target must differ')
        yield env
        return
    ssh_host = config.get('DATABASE_SYNC_SSH_HOST') or host
    if not re.fullmatch(r'[A-Za-z0-9_.-]+', ssh_user) or not re.fullmatch(r'[A-Za-z0-9_.:-]+', ssh_host) or ssh_host.startswith('-'):
        raise ValueError('Invalid SSH destination')
    remote_port = int(config.get('DATABASE_SYNC_PORT', '5432'))
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        local_port = sock.getsockname()[1]
    args = ['ssh', '-N', '-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
            '-o', 'ExitOnForwardFailure=yes', '-o', 'ConnectTimeout=10', '-o', 'ServerAliveInterval=30',
            '-p', str(int(config.get('DATABASE_SYNC_SSH_PORT', '22')))]
    if config.get('DATABASE_SYNC_SSH_KEY'):
        args += ['-i', config['DATABASE_SYNC_SSH_KEY']]
    args += ['-L', f'127.0.0.1:{local_port}:127.0.0.1:{remote_port}', f'{ssh_user}@{ssh_host}']
    process = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(100):
            if process.poll() is not None:
                raise RuntimeError('SSH tunnel failed; check key login and verified known_hosts')
            try:
                with socket.create_connection(('127.0.0.1', local_port), timeout=.2):
                    break
            except OSError:
                time.sleep(.1)
        else:
            raise RuntimeError('SSH tunnel did not become ready')
        # PostgreSQL is carried entirely inside the verified encrypted SSH tunnel.
        env.update(PGHOST='127.0.0.1', PGPORT=str(local_port), PGSSLMODE='disable')
        env.pop('PGSSLROOTCERT', None)
        yield env
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()


def identifier(value):
    return '"' + value.replace('"', '""') + '"'


def restore_transaction(schemas, archive_schemas, sql):
    if set(schemas) - {'public', 'drizzle'} or set(archive_schemas) - {'public', 'drizzle'}:
        raise ValueError('Unexpected application schema; review before replacing target')
    prefix = "BEGIN;\nSET LOCAL lock_timeout = '15s';\n"
    prefix += ''.join(f'DROP SCHEMA IF EXISTS {identifier(schema)} CASCADE;\n' for schema in schemas)
    # pg_dump versions may omit creation of the built-in public schema.
    if 'public' not in archive_schemas:
        prefix += 'CREATE SCHEMA public;\n'
    return prefix + sql + '\nCOMMIT;\n'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Read-only connection and version check')
    args = parser.parse_args()
    os.umask(0o077)
    config = {**dotenv_values(ROOT / '.env'), **os.environ}
    source = source_environment(config)
    retention = int(config.get('DATABASE_SYNC_RETENTION_DAYS', '14'))
    if not 1 <= retention <= 365:
        raise ValueError('Retention must be between 1 and 365 days')
    directory = ROOT / 'var' / 'database-sync'
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    directory.chmod(0o700)
    with (directory / 'sync.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError('Another database synchronization is running')
        with target_environment(config, source) as target:
            source_major = int(query(source, 'show server_version_num')) // 10000
            target_major = int(query(target, 'show server_version_num')) // 10000
            dump_major = int(re.search(r'(\d+)\.', command(['pg_dump', '--version']))[1])
            if dump_major != source_major or target_major < source_major:
                raise RuntimeError('Require pg_dump matching source major and target major >= source major')
            source_schemas = query(source, SCHEMAS_SQL).splitlines()
            target_schemas = query(target, SCHEMAS_SQL).splitlines()
            if set(source_schemas + target_schemas) - {'public', 'drizzle'}:
                raise RuntimeError('Unexpected schema; target replacement requires review')
            extensions = query(target, "select extname from pg_extension where extname <> 'plpgsql'")
            if extensions:
                raise RuntimeError('Target has additional extensions; review before replacing schemas')
            tables = int(query(source, TABLES_SQL))
            target_tables = int(query(target, TABLES_SQL))
            if tables < 20:
                raise RuntimeError('Source does not look like an initialized StockDepth database')
            print(json.dumps({'sourceMajor': source_major, 'targetMajor': target_major,
                              'sourceTables': tables, 'targetTables': target_tables, 'checkOnly': args.check}), flush=True)
            if args.check:
                return
            stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
            source_dump = directory / f'source-{stamp}.dump'
            target_dump = directory / f'target-before-{stamp}.dump'
            sql_file = directory / f'restore-{stamp}.sql'
            command(['pg_dump', '--format=custom', '--no-owner', '--no-acl', '--file', str(source_dump)], source)
            listing = command(['pg_restore', '--list', str(source_dump)])
            # Target backup MUST succeed before any destructive statement is sent.
            command(['pg_dump', '--format=custom', '--no-owner', '--no-acl', '--file', str(target_dump)], target)
            command(['pg_restore', '--list', str(target_dump)])
            command(['pg_restore', '--no-owner', '--no-acl', '--file', str(sql_file), str(source_dump)])
            archive_schemas = re.findall(r'\bSCHEMA - (public|drizzle)\b', listing)
            sql_file.write_text(restore_transaction(target_schemas, archive_schemas, sql_file.read_text()))
            try:
                command(['psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '--file', str(sql_file)], target)
            finally:
                sql_file.unlink(missing_ok=True)
            restored_tables = int(query(target, TABLES_SQL))
            if restored_tables != tables:
                raise RuntimeError('Restored table count differs; keep backup files and investigate')
            digest = hashlib.sha256(source_dump.read_bytes()).hexdigest()
            (directory / f'manifest-{stamp}.json').write_text(json.dumps({
                'createdAt': stamp, 'sourceDump': source_dump.name, 'targetBeforeDump': target_dump.name,
                'sha256': digest, 'tables': restored_tables, 'targetDatabase': target['PGDATABASE']}, indent=2))
            cutoff = time.time() - retention * 86400
            for pattern in ('source-*.dump', 'target-before-*.dump', 'manifest-*.json'):
                for file in directory.glob(pattern):
                    if file.stat().st_mtime < cutoff:
                        file.unlink()
            print(json.dumps({'status': 'synchronized', 'tables': restored_tables, 'backup': source_dump.name}), flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(f'Database synchronization failed: {error}', file=sys.stderr)
        sys.exit(1)
