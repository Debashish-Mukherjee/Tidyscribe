from app.database import SessionLocal
from app.models import Snippet, Template
from app.seed import TEMPLATE_SECTIONS, seed_defaults


def test_seed_is_idempotent_and_complete() -> None:
    with SessionLocal() as db:
        db.query(Snippet).delete()
        db.query(Template).delete()
        db.commit()
        seed_defaults(db)
        seed_defaults(db)
        assert db.query(Template).count() == len(TEMPLATE_SECTIONS)
        assert db.query(Snippet).count() == 8
        names = {name for (name,) in db.query(Template.name).all()}
        assert set(TEMPLATE_SECTIONS) <= names
        assert db.query(Template).filter(Template.name == "ADR").count() == 1

        adr = db.query(Template).filter(Template.name == "ADR").one()
        for section in ("Context", "Decision", "Alternatives", "Consequences"):
            assert f"## {section}" in adr.body

        categories = {category for (category,) in db.query(Snippet.category).all()}
        assert {"Architecture", "Azure", "AWS", "Terraform", "SQL", "Python", "PowerShell", "Kubernetes"} <= categories
