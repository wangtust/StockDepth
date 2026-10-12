"""Chinese-market news and sentiment helpers for A-share and Hong Kong tickers.

The US-oriented StockTwits/Reddit sources are weak for ``.SZ``, ``.SS`` and
``.HK`` instruments. This module adds Chinese-language public sources that
degrade cleanly when an endpoint is unavailable.
"""

from __future__ import annotations

import json
import re
import uuid
from datetime import datetime
from html import unescape
from typing import Iterable

import requests


UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126 Safari/537.36"


def is_chinese_market_ticker(ticker: str) -> bool:
    upper = ticker.upper()
    return upper.endswith((".SZ", ".SS", ".HK"))


def _plain(text: str) -> str:
    text = re.sub(r"<[^>]+>", "", text or "")
    return unescape(text).strip()


def _ticker_code(ticker: str) -> str:
    return ticker.upper().split(".")[0]


def _eastmoney_keywords(ticker: str) -> list[str]:
    upper = ticker.upper()
    code = _ticker_code(upper)
    profile = fetch_eastmoney_stock_profile(ticker)
    name = profile.get("name", "")
    if upper.endswith(".HK"):
        return [item for item in [name, code.zfill(5), upper] if item]
    return [item for item in [name, code, upper] if item]


def fetch_eastmoney_stock_profile(ticker: str) -> dict:
    """Fetch a lightweight Eastmoney stock profile for name/industry lookup."""
    upper = ticker.upper()
    code = _ticker_code(upper)
    if upper.endswith(".HK"):
        secid = f"116.{code.zfill(5)}"
    elif upper.endswith(".SS"):
        secid = f"1.{code}"
    else:
        secid = f"0.{code}"
    try:
        resp = requests.get(
            "https://push2.eastmoney.com/api/qt/stock/get",
            params={"secid": secid, "fields": "f57,f58,f127"},
            headers={"User-Agent": UA},
            timeout=8,
        )
        resp.raise_for_status()
        data = resp.json().get("data") or {}
        return {
            "code": data.get("f57", ""),
            "name": data.get("f58", ""),
            "industry": data.get("f127", ""),
        }
    except Exception:
        return {}


def _is_relevant_article(article: dict, ticker: str, profile: dict | None = None) -> bool:
    profile = profile or fetch_eastmoney_stock_profile(ticker)
    code = _ticker_code(ticker)
    hk_code = code.zfill(5)
    needles = [code, ticker.upper()]
    if profile.get("name"):
        needles.append(profile["name"])
    if ticker.upper().endswith(".HK"):
        needles.append(hk_code)
    haystack = f"{article.get('title', '')} {article.get('content', '')}"
    haystack = _plain(haystack)
    return any(needle and needle in haystack for needle in needles)


def _within_range(date_text: str, start_date: str | None, end_date: str | None) -> bool:
    if not date_text or not start_date or not end_date:
        return True
    try:
        item_dt = datetime.strptime(date_text[:10], "%Y-%m-%d")
        start_dt = datetime.strptime(start_date, "%Y-%m-%d")
        end_dt = datetime.strptime(end_date, "%Y-%m-%d")
        return start_dt <= item_dt <= end_dt
    except Exception:
        return True


def fetch_eastmoney_stock_news(
    ticker: str,
    page_size: int = 10,
    start_date: str | None = None,
    end_date: str | None = None,
) -> list[dict]:
    """Fetch Eastmoney article search results for a ticker/code."""
    rows: list[dict] = []
    seen: set[str] = set()
    url = "https://search-api-web.eastmoney.com/search/jsonp"
    headers = {"User-Agent": UA, "Referer": "https://so.eastmoney.com/"}
    profile = fetch_eastmoney_stock_profile(ticker)

    for keyword in _eastmoney_keywords(ticker):
        inner = json.dumps(
            {
                "uid": "",
                "keyword": keyword,
                "type": ["cmsArticleWebOld"],
                "client": "web",
                "clientType": "web",
                "clientVersion": "curr",
                "param": {
                    "cmsArticleWebOld": {
                        "searchScope": "default",
                        "sort": "default",
                        "pageIndex": 1,
                        "pageSize": page_size,
                        "preTag": "",
                        "postTag": "",
                    }
                },
            },
            ensure_ascii=False,
            separators=(",", ":"),
        )
        try:
            resp = requests.get(
                url,
                params={"cb": "jQuery_news", "param": inner},
                headers=headers,
                timeout=12,
            )
            resp.raise_for_status()
            text = resp.text
            data = json.loads(text[text.index("(") + 1 : text.rindex(")")])
            articles = data.get("result", {}).get("cmsArticleWebOld", []) or []
        except Exception:
            continue

        for article in articles:
            title = _plain(article.get("title", ""))
            date_text = article.get("date", "")
            if not _within_range(date_text, start_date, end_date):
                continue
            if not _is_relevant_article(article, ticker, profile):
                continue
            link = article.get("url", "")
            key = link or title
            if not title or key in seen:
                continue
            seen.add(key)
            rows.append(
                {
                    "title": title,
                    "summary": _plain(article.get("content", ""))[:260],
                    "time": date_text,
                    "source": article.get("mediaName", "东方财富搜索"),
                    "url": link,
                }
            )
    return rows[:page_size]


def fetch_eastmoney_fast_news(page_size: int = 12) -> list[dict]:
    """Fetch Eastmoney 7x24 rolling market news."""
    url = "https://np-weblist.eastmoney.com/comm/web/getFastNewsList"
    params = {
        "client": "web",
        "biz": "web_724",
        "fastColumn": "102",
        "sortEnd": "",
        "pageSize": str(page_size),
        "req_trace": str(uuid.uuid4()),
    }
    try:
        resp = requests.get(
            url,
            params=params,
            headers={"User-Agent": UA, "Referer": "https://kuaixun.eastmoney.com/"},
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()
    except Exception:
        return []

    rows = []
    for item in data.get("data", {}).get("fastNewsList", []) or []:
        title = _plain(item.get("title", ""))
        if not title:
            continue
        rows.append(
            {
                "title": title,
                "summary": _plain(item.get("summary", ""))[:260],
                "time": item.get("showTime", ""),
                "source": "东方财富7x24",
                "url": item.get("url", ""),
            }
        )
    return rows


def fetch_cninfo_announcements(ticker: str, page_size: int = 10) -> list[dict]:
    """Fetch recent CNINFO announcements for A-share tickers."""
    upper = ticker.upper()
    if not upper.endswith((".SZ", ".SS")):
        return []

    code = _ticker_code(upper)
    if upper.endswith(".SS"):
        org_id = f"gssh0{code}"
        column = "sse"
        plate = "sh"
    else:
        org_id = f"gssz0{code}"
        column = "szse"
        plate = "sz"

    payload = {
        "stock": f"{code},{org_id}",
        "tabName": "fulltext",
        "pageSize": str(page_size),
        "pageNum": "1",
        "column": column,
        "category": "",
        "plate": plate,
        "searchkey": "",
        "secid": "",
        "sortName": "",
        "sortType": "",
        "isHLtitle": "true",
    }
    try:
        resp = requests.post(
            "https://www.cninfo.com.cn/new/hisAnnouncement/query",
            data=payload,
            headers={
                "User-Agent": UA,
                "Referer": "https://www.cninfo.com.cn/new/commonUrl/pageOfSearch?url=disclosure/list/search",
            },
            timeout=12,
        )
        resp.raise_for_status()
        data = resp.json()
    except Exception:
        return []

    rows = []
    for item in data.get("announcements") or []:
        ts = item.get("announcementTime")
        date_text = ""
        if ts:
            try:
                date_text = datetime.fromtimestamp(ts / 1000).strftime("%Y-%m-%d")
            except Exception:
                date_text = str(ts)
        url = item.get("adjunctUrl", "")
        if url:
            url = "https://static.cninfo.com.cn/" + url.lstrip("/")
        rows.append(
            {
                "title": _plain(item.get("announcementTitle", "")),
                "summary": item.get("announcementTypeName", "公司公告") or "公司公告",
                "time": date_text,
                "source": "巨潮资讯",
                "url": url,
            }
        )
    return rows


def _format_articles(title: str, articles: Iterable[dict]) -> str:
    articles = list(articles)
    if not articles:
        return f"## {title}\n\nNo items found.\n"
    text = f"## {title}\n\n"
    for article in articles:
        text += f"### {article.get('title', 'No title')} (source: {article.get('source', 'Unknown')})\n"
        if article.get("time"):
            text += f"Time: {article['time']}\n"
        if article.get("summary"):
            text += f"{article['summary']}\n"
        if article.get("url"):
            text += f"Link: {article['url']}\n"
        text += "\n"
    return text


def get_chinese_market_news(ticker: str, start_date: str, end_date: str) -> str:
    """Return formatted Chinese-market news for A-share/HK tickers."""
    if not is_chinese_market_ticker(ticker):
        return ""
    sections = [
        _format_articles("东方财富个股新闻", fetch_eastmoney_stock_news(ticker, start_date=start_date, end_date=end_date)),
        _format_articles("交易所/监管公告", fetch_cninfo_announcements(ticker)),
        _format_articles("东方财富7x24市场快讯", fetch_eastmoney_fast_news(8)),
    ]
    return (
        f"## 中文市场新闻补充 for {ticker}, from {start_date} to {end_date}\n\n"
        + "\n".join(sections)
    )


def get_chinese_market_sentiment(ticker: str, start_date: str, end_date: str) -> str:
    """Return Chinese-market sentiment proxy data.

    This intentionally uses news/announcements/rolling bulletins as sentiment
    proxies until first-class Snowball/Eastmoney-Guba integrations are added.
    """
    if not is_chinese_market_ticker(ticker):
        return ""
    return (
        f"## 中文市场情绪代理数据 for {ticker}, from {start_date} to {end_date}\n\n"
        "这些数据源更适合 A 股/港股：东方财富个股新闻、交易所公告、东方财富7x24快讯。"
        " StockTwits/Reddit 对该市场覆盖弱，已跳过以避免噪声。\n\n"
        + get_chinese_market_news(ticker, start_date, end_date)
    )
