import pytest

from app.services.diagram_service import convert_diagram, detect_source_format, expand_plantuml, plantuml_to_mermaid, ascii_to_drawio
from app.services.drawio_import import drawio_to_mermaid
from app.services.infra_diagrams import kubernetes_to_mermaid, terraform_to_mermaid
from app.services.mermaid_util import label


def test_label_keeps_line_breaks_and_escapes_markup() -> None:
    assert label('Kind\nname "x" <b>bold</b>') == "Kind<br/>name #quot;x#quot; bold"
    assert label("a<br>b") == "a<br/>b"
    assert label("1 < 2") == "1 #lt; 2"


ACTIVITY = """@startuml
start
:Receive order;
if (In stock?) then (yes)
  :Pack items;
elseif (Backorder?) then (later)
  :Notify customer;
else (no)
  :Cancel;
endif
while (More items?) is (yes)
  :Scan item;
endwhile (no)
repeat
  :Retry payment;
repeat while (Failed?) is (yes)
fork
  :Email;
fork again
  :SMS;
end fork
:Ship;
stop
@enduml"""


def test_activity_diagram_becomes_a_flowchart() -> None:
    mermaid = plantuml_to_mermaid(ACTIVITY)
    assert mermaid and mermaid.startswith("flowchart TD")
    assert '"Receive order"' in mermaid and '{"In stock?"}' in mermaid
    assert '|"yes"|' in mermaid and '|"no"|' in mermaid
    # Both fork branches rejoin on the next action.
    lines = mermaid.splitlines()
    email = next(line for line in lines if '"Email"' in line).strip().split("[")[0]
    sms = next(line for line in lines if '"SMS"' in line).strip().split("[")[0]
    ship = next(line for line in lines if '"Ship"' in line).strip().split("[")[0]
    assert f"{email} --> {ship}" in mermaid and f"{sms} --> {ship}" in mermaid
    assert "End" in mermaid


def test_activity_back_edges_point_to_the_loop_head() -> None:
    mermaid = plantuml_to_mermaid("@startuml\nstart\nwhile (more?) is (yes)\n:work;\nendwhile (no)\n:done;\nstop\n@enduml")
    assert mermaid is not None
    lines = mermaid.splitlines()
    cond = next(line for line in lines if '"more?"' in line).strip().split("{")[0]
    work = next(line for line in lines if '"work"' in line).strip().split("[")[0]
    assert f"{work} --> {cond}" in mermaid


def test_unbalanced_activity_is_rejected() -> None:
    assert plantuml_to_mermaid("@startuml\nstart\n:a;\nendif\n@enduml") is None


COMPONENT = """@startuml
package "Backend" {
  [API] as api
  database "Postgres" as db
}
[Web UI] --> api : HTTPS
api ..> db : SQL
interface Auth
api -- Auth
@enduml"""


def test_component_diagram_becomes_a_flowchart_with_subgraphs() -> None:
    mermaid = plantuml_to_mermaid(COMPONENT)
    assert mermaid and mermaid.startswith("flowchart LR")
    assert 'subgraph Backend["Backend"]' in mermaid
    assert 'db[("Postgres")]' in mermaid
    assert 'Web_UI --> |' not in mermaid
    assert 'Web_UI -->|"HTTPS"| api' in mermaid
    assert 'api -.->|"SQL"| db' in mermaid
    assert "api --- Auth" in mermaid


def test_interface_keyword_alone_still_means_class_diagram() -> None:
    mermaid = plantuml_to_mermaid("@startuml\ninterface Shape\nclass Circle\nShape <|.. Circle\n@enduml")
    assert mermaid and mermaid.startswith("classDiagram")


def test_state_diagrams_are_not_mistaken_for_components() -> None:
    mermaid = plantuml_to_mermaid("@startuml\n[*] --> Idle\nIdle --> Busy : go\n@enduml")
    assert mermaid and mermaid.startswith("stateDiagram-v2")


def test_expand_converts_activity_fences() -> None:
    result = expand_plantuml("```plantuml\nstart\n:a;\n:b;\nstop\n```")
    assert result.converted == 1 and "```mermaid\nflowchart TD" in result.markdown


def test_drawio_round_trip_from_ascii() -> None:
    xml = ascii_to_drawio("+---+\n| A |\n+---+\n  |\n+---+\n| B |\n+---+")
    mermaid = drawio_to_mermaid(xml)
    assert mermaid and mermaid.count("-->") == 1
    assert '"A"' in mermaid and '"B"' in mermaid


DRAWIO = """<mxfile><diagram><mxGraphModel><root>
<mxCell id="0"/><mxCell id="1" parent="0"/>
<mxCell id="g" value="Cloud" style="swimlane;" vertex="1" parent="1"><mxGeometry x="0" y="0" width="300" height="100" as="geometry"/></mxCell>
<mxCell id="a" value="Web&lt;br&gt;App" style="rounded=1;" vertex="1" parent="g"><mxGeometry x="10" y="10" as="geometry"/></mxCell>
<mxCell id="b" value="Data" style="shape=cylinder3;" vertex="1" parent="g"><mxGeometry x="200" y="10" as="geometry"/></mxCell>
<mxCell id="c" value="Decide" style="rhombus;" vertex="1" parent="1"><mxGeometry x="400" y="10" as="geometry"/></mxCell>
<mxCell id="e1" edge="1" source="a" target="b" parent="1" style="dashed=1;"/>
<mxCell id="l1" value="reads" style="edgeLabel;" vertex="1" connectable="0" parent="e1"/>
<mxCell id="e2" value="go" edge="1" source="b" target="c" parent="1" style="endArrow=none;"/>
</root></mxGraphModel></diagram></mxfile>"""


def test_drawio_containers_shapes_styles_and_edge_labels() -> None:
    mermaid = drawio_to_mermaid(DRAWIO)
    assert mermaid and mermaid.startswith("flowchart LR")
    assert 'subgraph Dg["Cloud"]' in mermaid
    assert 'Da("Web<br/>App")' in mermaid
    assert 'Db[("Data")]' in mermaid and 'Dc{"Decide"}' in mermaid
    assert 'Da -.->|"reads"| Db' in mermaid
    assert 'Db ---|"go"| Dc' in mermaid


def test_drawio_compressed_pages_are_inflated() -> None:
    import base64
    import urllib.parse
    import zlib

    inner = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="a" value="X" vertex="1" parent="1"/><mxCell id="b" value="Y" vertex="1" parent="1"/><mxCell id="e" edge="1" source="a" target="b" parent="1"/></root></mxGraphModel>'
    compressor = zlib.compressobj(wbits=-15)
    payload = base64.b64encode(compressor.compress(urllib.parse.quote(inner).encode()) + compressor.flush()).decode()
    mermaid = drawio_to_mermaid(f"<mxfile><diagram>{payload}</diagram></mxfile>")
    assert mermaid and 'Da["X"] ' not in mermaid and "Da --> Db" in mermaid


def test_drawio_rejects_entities_and_garbage() -> None:
    assert drawio_to_mermaid('<!DOCTYPE x [<!ENTITY a "b">]><mxfile><diagram/></mxfile>') is None
    assert drawio_to_mermaid("<mxfile><diagram>not base64 !!</diagram></mxfile>") is None
    assert drawio_to_mermaid("<mxfile") is None


TERRAFORM = '''
# network
resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16" # trailing comment
}
resource "aws_subnet" "a" {
  vpc_id = aws_vpc.main.id
}
data "aws_ami" "ubuntu" {
  most_recent = true
}
resource "aws_instance" "web" {
  ami       = data.aws_ami.ubuntu.id
  subnet_id = "${aws_subnet.a.id}"
  tags = { Name = "aws_vpc.main" }
}
module "dns" {
  source = "./dns"
  target = aws_instance.web.public_ip
}
output "ip" {
  value = aws_instance.web.public_ip
}
'''


def test_terraform_resources_data_modules_and_outputs() -> None:
    mermaid = terraform_to_mermaid(TERRAFORM)
    assert mermaid and mermaid.startswith("flowchart LR")
    assert 'T1["aws_vpc<br/>main"]' in mermaid
    assert 'T3{{"data aws_ami<br/>ubuntu"}}' in mermaid
    assert "T1 --> T2" in mermaid  # vpc -> subnet
    assert "T2 --> T4" in mermaid  # interpolation reference
    assert "T3 --> T4" in mermaid  # data source
    assert "T4 --> T5" in mermaid and "T4 --> T6" in mermaid


def test_terraform_ignores_commented_references_and_non_blocks() -> None:
    source = 'resource "a_b" "x" {}\nresource "a_b" "y" {\n  # a_b.x.id\n  /* a_b.x */\n}\n'
    mermaid = terraform_to_mermaid(source)
    assert mermaid and "-->" not in mermaid
    assert terraform_to_mermaid('variable "x" {}') is None


K8S = """
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata: {name: web, namespace: shop}
spec:
  rules:
    - host: shop.example.com
      http:
        paths:
          - path: /
            backend: {service: {name: web, port: {number: 80}}}
---
apiVersion: v1
kind: Service
metadata: {name: web, namespace: shop}
spec:
  selector: {app: web}
---
apiVersion: apps/v1
kind: Deployment
metadata: {name: web, namespace: shop}
spec:
  template:
    metadata: {labels: {app: web}}
    spec:
      serviceAccountName: web-sa
      containers:
        - name: web
          envFrom: [{configMapRef: {name: web-config}}]
          env: [{name: P, valueFrom: {secretKeyRef: {name: web-secret, key: p}}}]
      volumes: [{name: d, persistentVolumeClaim: {claimName: data}}]
---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata: {name: web, namespace: shop}
spec:
  scaleTargetRef: {kind: Deployment, name: web}
---
apiVersion: v1
kind: ConfigMap
metadata: {name: web-config, namespace: shop}
---
apiVersion: v1
kind: Secret
metadata: {name: web-secret, namespace: shop}
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata: {name: data, namespace: shop}
---
apiVersion: v1
kind: ServiceAccount
metadata: {name: web-sa, namespace: shop}
"""


def test_kubernetes_links_ingress_service_workload_and_config() -> None:
    mermaid = kubernetes_to_mermaid(K8S)
    assert mermaid and mermaid.startswith("flowchart LR")
    ids = {line.split("[")[0].split("{")[0].split("(")[0].strip(): line for line in mermaid.splitlines() if "<br/>" in line}
    by_kind = {kind: key for key, line in ids.items() for kind in ("Ingress", "Service", "Deployment", "HorizontalPodAutoscaler", "ConfigMap", "Secret", "PersistentVolumeClaim", "ServiceAccount") if f'"{kind}<br/>' in line}
    assert f'{by_kind["Ingress"]} -->|"shop.example.com/"| {by_kind["Service"]}' in mermaid
    for pair in [("Service", "Deployment"), ("ConfigMap", "Deployment"), ("Secret", "Deployment"), ("PersistentVolumeClaim", "Deployment")]:
        assert f"{by_kind[pair[0]]} --> {by_kind[pair[1]]}" in mermaid
    assert f'{by_kind["HorizontalPodAutoscaler"]} -->|"scales"| {by_kind["Deployment"]}' in mermaid
    assert f'{by_kind["ServiceAccount"]} -->|"uses"| {by_kind["Deployment"]}' in mermaid


def test_kubernetes_ignores_selectors_that_do_not_match_and_other_namespaces() -> None:
    source = K8S.replace("selector: {app: web}", "selector: {app: other}")
    mermaid = kubernetes_to_mermaid(source)
    assert mermaid and "shop.example.com" in mermaid
    assert not any(line.strip().startswith("K2 -->") for line in mermaid.splitlines())


def test_kubernetes_rejects_non_manifests_and_alias_bombs() -> None:
    assert kubernetes_to_mermaid("just: a map") is None
    assert kubernetes_to_mermaid("a: [unclosed") is None
    bomb = "x: &a [1]\n" + "\n".join(f"k{i}: *a" for i in range(80))
    assert kubernetes_to_mermaid(bomb) is None


def test_auto_detection_and_mermaid_only_targets() -> None:
    assert detect_source_format(TERRAFORM) == "terraform"
    assert detect_source_format(K8S) == "kubernetes"
    assert detect_source_format(DRAWIO) == "drawio"
    assert detect_source_format(COMPONENT) == "plantuml"
    content, _, extension = convert_diagram(TERRAFORM, "mermaid")
    assert content.startswith("flowchart") and extension == "mmd"
    with pytest.raises(ValueError, match="only be converted to Mermaid"):
        convert_diagram(K8S, "svg")
    with pytest.raises(ValueError, match="unsupported"):
        convert_diagram("apiVersion: v1\nkind: Thing\nmetadata: {}", "mermaid")
