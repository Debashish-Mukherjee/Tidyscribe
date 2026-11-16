from __future__ import annotations

from sqlalchemy.orm import Session

from app.models import Snippet, Template

TEMPLATE_SECTIONS: dict[str, list[str]] = {
    "Solution Design": ["Executive Summary", "Requirements", "Architecture", "Dependencies", "Risks", "Assumptions"],
    "HLD": ["Context", "Architecture", "Systems", "Integrations", "Deployment"],
    "LLD": ["Modules", "Interfaces", "Data Models", "Errors", "Validation"],
    "ADR": ["Context", "Decision", "Alternatives", "Consequences"],
    "RFC": ["Proposal", "Design", "Impact", "Migration"],
    "Runbook": ["Purpose", "Pre-Requisites", "Steps", "Validation", "Rollback"],
}

SNIPPETS: list[tuple[str, str, str, str]] = [
    ("Context diagram", "Architecture", "architecture,mermaid", "```mermaid\nflowchart LR\n  User --> App\n  App --> Database[(Database)]\n```"),
    ("Azure resource group", "Azure", "azure,cli", "```bash\naz group create --name <rg-name> --location <region>\n```"),
    ("AWS S3 bucket", "AWS", "aws,cli", "```bash\naws s3api create-bucket --bucket <bucket-name> --region <region>\n```"),
    ("Terraform provider block", "Terraform", "terraform", "```hcl\nterraform {\n  required_providers {\n    azurerm = {\n      source  = \"hashicorp/azurerm\"\n      version = \"~> 4.0\"\n    }\n  }\n}\n```"),
    ("SQL index", "SQL", "sql,performance", "```sql\nCREATE INDEX idx_orders_customer ON orders (customer_id);\n```"),
    ("Python retry decorator", "Python", "python", "```python\nimport functools, time\n\ndef retry(times=3, delay=1.0):\n    def wrap(fn):\n        @functools.wraps(fn)\n        def inner(*args, **kwargs):\n            for attempt in range(times):\n                try:\n                    return fn(*args, **kwargs)\n                except Exception:\n                    if attempt == times - 1:\n                        raise\n                    time.sleep(delay)\n        return inner\n    return wrap\n```"),
    ("PowerShell service check", "PowerShell", "powershell", "```powershell\nGet-Service | Where-Object Status -eq 'Stopped'\n```"),
    ("Kubernetes deployment", "Kubernetes", "kubernetes,yaml", "```yaml\napiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: app\nspec:\n  replicas: 2\n  selector:\n    matchLabels:\n      app: app\n  template:\n    metadata:\n      labels:\n        app: app\n    spec:\n      containers:\n        - name: app\n          image: <image>\n```"),
]


def _template_body(name: str, sections: list[str]) -> str:
    parts = [f"# {name}"]
    parts.extend(f"## {section}\n\n_Describe the {section.lower()}._" for section in sections)
    return "\n\n".join(parts) + "\n"


def seed_defaults(db: Session) -> None:
    """Insert built-in templates and snippets; safe to run on every startup."""
    existing = {name for (name,) in db.query(Template.name).all()}
    for name, sections in TEMPLATE_SECTIONS.items():
        if name not in existing:
            db.add(Template(name=name, category="document", body=_template_body(name, sections)))

    if db.query(Snippet).count() == 0:
        for title, category, tags, body in SNIPPETS:
            db.add(Snippet(title=title, category=category, tags=tags, body=body))
    db.commit()
