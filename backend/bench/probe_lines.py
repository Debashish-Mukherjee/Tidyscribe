from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import Paragraph

from app.services.export_service import _pdf_fonts

sans, mono, _ = _pdf_fonts()
style = ParagraphStyle("b", fontName=sans, fontSize=10.5, leading=15)
p = Paragraph('a <u>under</u> <strike>strike</strike> <font backColor="#FFF8C5">mark</font> <sub>s</sub><super>p</super> <a href="http://x.y">lk</a>', style)
p.wrap(300, 1000)
for line in p.blPara.lines:
    for w in line.words:
        print({k: v for k, v in vars(w).items() if k in ("text", "us_lines", "link", "backColor", "rise", "fontSize", "textColor")})
