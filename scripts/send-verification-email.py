"""Send a registration code over authenticated TLS SMTP; stdin carries the message."""
import json
import os
import smtplib
import ssl
import sys
from email.message import EmailMessage


def main():
    payload = json.load(sys.stdin)
    sender = os.environ['EMAIL_SENDER']
    message = EmailMessage()
    message['From'] = sender
    message['To'] = payload['email']
    message['Subject'] = 'StockDepth 注册邮箱验证码'
    message.set_content(
        f"你的 StockDepth 注册验证码是：{payload['code']}\n\n"
        '验证码 10 分钟内有效，请勿向他人透露。\n'
        '如果你没有申请注册，请忽略此邮件。\n'
    )
    with smtplib.SMTP_SSL(os.environ.get('SMTP_HOST', 'smtp.qq.com'),
                          int(os.environ.get('SMTP_PORT', '465')),
                          timeout=15, context=ssl.create_default_context()) as smtp:
        smtp.login(sender, os.environ['SMTP_AUTH_CODE'])
        smtp.send_message(message)


if __name__ == '__main__':
    try:
        main()
    except Exception:
        # Neither SMTP authentication errors nor message contents enter logs.
        print('SMTP delivery failed', file=sys.stderr)
        sys.exit(1)
