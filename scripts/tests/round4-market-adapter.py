"""Local provider normalization tests, no network or model calls."""
from datetime import datetime, timezone
import importlib.util
from pathlib import Path
import unittest
import sys
from types import SimpleNamespace
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('market_adapter', Path(__file__).parents[2] / 'apps/api/stockdepth/data/market_adapter.py')
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)

class IdentityTests(unittest.TestCase):
    def info(self, symbol='AAPL', exchange='NMS', currency='USD', timezone_name='America/New_York'):
        return {'symbol':symbol,'exchange':exchange,'currency':currency,'exchangeTimezoneName':timezone_name,'quoteType':'EQUITY','regularMarketPrice':1.23456789,'regularMarketTime':1791817200}
    def test_bare_symbol_requires_provider_identity(self):
        self.assertEqual(adapter.identity_from_info('AAPL', self.info())['exchange'],'XNAS')
        with self.assertRaises(ValueError): adapter.identity_from_info('AAPL', {})
        with self.assertRaises(ValueError): adapter.identity_from_info('AAPL', self.info(exchange='UNKNOWN'))
        with self.assertRaises(ValueError): adapter.identity_from_info('AAPL', self.info(symbol='MSFT'))
    def test_exchange_currency_and_timezone(self):
        for currency,timezone_name in [('EUR','America/New_York'),('USD','UTC')]:
            with self.assertRaises(ValueError): adapter.identity_from_info('AAPL',self.info(currency=currency,timezone_name=timezone_name))
        self.assertEqual(adapter.identity_from_info('600519.SS',self.info('600519.SS','SHH','CNY','Asia/Shanghai'))['exchange'],'XSHG')
        self.assertEqual(adapter.identity_from_info('0700.HK',self.info('0700.HK','HKG','HKD','Asia/Hong_Kong'))['exchange'],'XHKG')
        with self.assertRaises(ValueError): adapter.identity_from_info('600519',self.info('600519','SHH','CNY','Asia/Shanghai'))
    def test_quote_uses_actual_timestamp_decimal_and_unadjusted_type(self):
        now=datetime(2026,10,12,15,0,tzinfo=timezone.utc)
        i=adapter.identity_from_info('AAPL',self.info())
        quote=adapter.quote_from_info(self.info(),i,now)
        self.assertEqual(quote['price'],'1.23456789')
        self.assertEqual(quote['quotedAt'],'2026-10-12T15:00:00+00:00')
        self.assertEqual(quote['priceType'],'regular_unadjusted')
        bad=self.info();bad.pop('regularMarketTime')
        with self.assertRaises(ValueError): adapter.quote_from_info(bad,i,now)
        bad=self.info();bad['regularMarketTime']+=3600
        with self.assertRaises(ValueError): adapter.quote_from_info(bad,i,now)
    def test_daily_failure_keeps_independent_quote_and_identity(self):
        info = self.info()
        info['regularMarketTime'] = int(datetime.now(timezone.utc).timestamp()) - 60
        class Ticker:
            def get_info(self): return info
            def history(self, **kwargs):
                self.arguments = kwargs
                raise RuntimeError('raw-provider-secret-must-not-escape')
        ticker = Ticker()
        with patch.dict(sys.modules, {'yfinance': SimpleNamespace(Ticker=lambda _: ticker)}):
            result = adapter.fetch('AAPL', ['identity', 'quote', 'daily'])
        self.assertEqual(result['identity']['symbol'], 'AAPL')
        self.assertEqual(result['quote']['price'], '1.23456789')
        self.assertEqual(result['errors'], {'daily': 'invalid_or_unavailable_daily'})
        self.assertFalse(ticker.arguments['auto_adjust'])
        self.assertFalse(ticker.arguments['back_adjust'])
        self.assertNotIn('raw-provider-secret', str(result))
    def test_bad_prices_are_rejected(self):
        for value in [None,float('nan'),float('inf'),0,-1,'1,234.5','$99','10000000000000000']:
            with self.assertRaises(Exception): adapter.decimal(value)

if __name__ == '__main__': unittest.main()
