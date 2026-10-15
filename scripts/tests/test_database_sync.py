"""Local throwaway-database restore test; never contacts the backup server."""
import contextlib
import importlib.util
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import uuid

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('database_sync', ROOT / 'scripts/sync-database.py')
sync = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sync)


class DatabaseSyncTests(unittest.TestCase):
    def test_credentials_are_environment_only(self):
        env = sync.source_environment({'POSTGRES_URL': 'postgresql://fixture:encoded%40password@127.0.0.1:5432/fixture'})
        self.assertEqual(env['PGPASSWORD'], 'encoded@password')
        with patch.object(sync.subprocess, 'run') as run:
            run.return_value.returncode = 0
            run.return_value.stdout = 'ok'
            sync.command(['pg_dump', '--format=custom'], env)
            self.assertNotIn('encoded@password', ' '.join(run.call_args.args[0]))

    def test_same_database_and_schema_guards(self):
        source = sync.source_environment({'POSTGRES_URL': 'postgresql://fixture:p@127.0.0.1:5432/stockdepth'})
        with self.assertRaises(ValueError):
            with sync.target_environment({'DATABASE_SYNC_HOST': '127.0.0.1'}, source):
                pass
        with self.assertRaises(ValueError):
            sync.restore_transaction(['public', 'other_application'], ['public'], '')
        sql = sync.restore_transaction(['public', 'drizzle'], ['public', 'drizzle'], 'SELECT 1;')
        self.assertTrue(sql.startswith('BEGIN;'))
        self.assertTrue(sql.endswith('COMMIT;\n'))
        self.assertIn('DROP SCHEMA IF EXISTS "public" CASCADE;', sql)

    def test_local_restore_and_rollback(self):
        config = dict(sync.dotenv_values(ROOT / '.env'))
        source = sync.source_environment(config)
        createdb = sync.query(source, "select rolsuper or rolcreatedb from pg_roles where rolname=current_user")
        if createdb != 't':
            self.skipTest('Local database role needs CREATEDB for the isolated integration test')
        name = 'stockdepth_sync_test_' + uuid.uuid4().hex[:16]
        target = {**source, 'PGDATABASE': name}
        sync.query(source, 'CREATE DATABASE ' + sync.identifier(name) + ' TEMPLATE template0')
        try:
            sync.query(target, 'CREATE TABLE public.obsolete_backup_fixture (id integer); INSERT INTO public.obsolete_backup_fixture VALUES (1)')
            with tempfile.TemporaryDirectory() as folder:
                temp_root = Path(folder)
                @contextlib.contextmanager
                def local_target(_config, _source):
                    yield target
                with patch.object(sync, 'ROOT', temp_root), patch.object(sync, 'dotenv_values', return_value=config), patch.object(sync, 'target_environment', local_target), patch.object(sys, 'argv', ['sync-database']):
                    sync.main()
                backups = temp_root / 'var/database-sync'
                self.assertEqual(len(list(backups.glob('source-*.dump'))), 1)
                self.assertEqual(len(list(backups.glob('target-before-*.dump'))), 1)
                self.assertEqual(len(list(backups.glob('manifest-*.json'))), 1)
                self.assertEqual(sync.query(target, "select to_regclass('public.obsolete_backup_fixture') is null"), 't')
                self.assertEqual(sync.query(target, sync.TABLES_SQL), sync.query(source, sync.TABLES_SQL))
                self.assertEqual(sync.query(target, "select count(*)>0 from drizzle.__drizzle_migrations"), 't')
                self.assertFalse(list(backups.glob('restore-*.sql')))
                sync.query(target, 'CREATE TABLE public.rollback_fixture (id integer); INSERT INTO public.rollback_fixture VALUES (7)')
                bad = backups / 'bad.sql'
                bad.write_text(sync.restore_transaction(['public','drizzle'], ['public','drizzle'], 'INVALID SQL;'))
                with self.assertRaises(RuntimeError):
                    sync.command(['psql','-X','-v','ON_ERROR_STOP=1','--file',str(bad)], target)
                self.assertEqual(sync.query(target, 'select id from public.rollback_fixture'), '7')
        finally:
            sync.query(source, 'DROP DATABASE ' + sync.identifier(name) + ' WITH (FORCE)')


if __name__ == '__main__':
    unittest.main()
