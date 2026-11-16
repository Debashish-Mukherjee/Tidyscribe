"""Terraform and Kubernetes sources -> Mermaid dependency graphs."""
from __future__ import annotations

import re
from collections import defaultdict
from typing import Any

import yaml

from app.services.mermaid_util import edge, label, node

# ----------------------------------------------------------------- Terraform

_BLOCK_HEAD = re.compile(r'^[ \t]*(?P<kind>resource|data|module|output)[ \t]+(?P<labels>(?:"[^"\n]*"[ \t]*)+|[A-Za-z_][\w-]*[ \t]*)\{', re.MULTILINE)
_REFERENCE = re.compile(r"(?<![\w.-])((?:data\.)?[A-Za-z_]\w*\.[A-Za-z_][\w-]*)")


def _strip_comments(text: str) -> str:
    """Drop #, // and /* */ comments while leaving string contents (and comment markers inside them) alone."""
    out: list[str] = []
    index, length, in_string = 0, len(text), False
    while index < length:
        char = text[index]
        if in_string:
            out.append(char)
            if char == "\\" and index + 1 < length:
                out.append(text[index + 1])
                index += 1
            elif char == '"':
                in_string = False
        elif char == '"':
            in_string = True
            out.append(char)
        elif char == "#" or text.startswith("//", index):
            while index < length and text[index] != "\n":
                index += 1
            continue
        elif text.startswith("/*", index):
            end = text.find("*/", index + 2)
            index = length if end == -1 else end + 1
        else:
            out.append(char)
        index += 1
    return "".join(out)


def _body(text: str, open_index: int) -> tuple[str, int]:
    """Text between the braces starting at `open_index` and the index after the closing brace."""
    depth, index, in_string = 0, open_index, False
    while index < len(text):
        char = text[index]
        if in_string:
            if char == "\\":
                index += 1
            elif char == '"':
                in_string = False
        elif char == '"':
            in_string = True
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return text[open_index + 1:index], index + 1
        index += 1
    return text[open_index + 1:], len(text)


def terraform_to_mermaid(source: str) -> str | None:
    text = _strip_comments(source)
    blocks: list[tuple[str, str, str]] = []  # (key, shape, body); key is how other blocks reference it
    display: dict[str, str] = {}
    kinds: dict[str, str] = {}
    position = 0
    while match := _BLOCK_HEAD.search(text, position):
        names = re.findall(r'"([^"\n]*)"|([A-Za-z_][\w-]*)', match.group("labels"))
        parts = [quoted or bare for quoted, bare in names]
        kind = match.group("kind")
        body, position = _body(text, match.end() - 1)
        if kind == "resource" and len(parts) == 2:
            key, title = f"{parts[0]}.{parts[1]}", f"{parts[0]}\n{parts[1]}"
        elif kind == "data" and len(parts) == 2:
            key, title = f"data.{parts[0]}.{parts[1]}", f"data {parts[0]}\n{parts[1]}"
        elif kind == "module" and len(parts) == 1:
            key, title = f"module.{parts[0]}", f"module\n{parts[0]}"
        elif kind == "output" and len(parts) == 1:
            key, title = f"output.{parts[0]}", f"output\n{parts[0]}"
        else:
            continue
        blocks.append((key, kind, body))
        display[key] = title
        kinds[key] = kind

    if not blocks:
        return None

    ids = {key: f"T{number}" for number, (key, _, _) in enumerate(blocks, start=1)}
    shapes = {"resource": "rect", "data": "hexagon", "module": "subroutine", "output": "stadium"}
    out = ["flowchart LR"]
    out.extend("    " + node(ids[key], display[key], shapes[kinds[key]]) for key, _, _ in blocks)

    # Arrows follow creation order: the referenced block points at the block that uses it.
    seen: set[tuple[str, str]] = set()
    for key, _, body in blocks:
        for reference in _REFERENCE.findall(body):
            if reference in ids and reference != key and (reference, key) not in seen:
                seen.add((reference, key))
                out.append("    " + edge(ids[reference], ids[key]))
    return "\n".join(out)


# ---------------------------------------------------------------- Kubernetes

_WORKLOADS = {"Deployment", "StatefulSet", "DaemonSet", "ReplicaSet", "Job", "CronJob", "Pod"}
_SHAPES = {"Ingress": "hexagon", "Service": "stadium", "ConfigMap": "parallelogram", "Secret": "parallelogram", "PersistentVolumeClaim": "cylinder"}
_MAX_ALIASES = 50


def _pod_spec(obj: dict[str, Any]) -> dict[str, Any]:
    spec = obj.get("spec") or {}
    if obj.get("kind") == "Pod":
        return spec
    if obj.get("kind") == "CronJob":
        spec = ((spec.get("jobTemplate") or {}).get("spec")) or {}
    return ((spec.get("template") or {}).get("spec")) or {}


def _pod_labels(obj: dict[str, Any]) -> dict[str, str]:
    if obj.get("kind") == "Pod":
        return (obj.get("metadata") or {}).get("labels") or {}
    spec = obj.get("spec") or {}
    if obj.get("kind") == "CronJob":
        spec = ((spec.get("jobTemplate") or {}).get("spec")) or {}
    return (((spec.get("template") or {}).get("metadata")) or {}).get("labels") or {}


def _pod_references(pod: dict[str, Any]) -> list[tuple[str, str]]:
    refs: list[tuple[str, str]] = []
    for volume in pod.get("volumes") or []:
        if (volume.get("configMap") or {}).get("name"):
            refs.append(("ConfigMap", volume["configMap"]["name"]))
        if (volume.get("secret") or {}).get("secretName"):
            refs.append(("Secret", volume["secret"]["secretName"]))
        if (volume.get("persistentVolumeClaim") or {}).get("claimName"):
            refs.append(("PersistentVolumeClaim", volume["persistentVolumeClaim"]["claimName"]))
    for container in [*(pod.get("containers") or []), *(pod.get("initContainers") or [])]:
        for source in container.get("envFrom") or []:
            if (source.get("configMapRef") or {}).get("name"):
                refs.append(("ConfigMap", source["configMapRef"]["name"]))
            if (source.get("secretRef") or {}).get("name"):
                refs.append(("Secret", source["secretRef"]["name"]))
        for env in container.get("env") or []:
            from_ = env.get("valueFrom") or {}
            if (from_.get("configMapKeyRef") or {}).get("name"):
                refs.append(("ConfigMap", from_["configMapKeyRef"]["name"]))
            if (from_.get("secretKeyRef") or {}).get("name"):
                refs.append(("Secret", from_["secretKeyRef"]["name"]))
    if pod.get("serviceAccountName"):
        refs.append(("ServiceAccount", pod["serviceAccountName"]))
    return refs


def _ingress_backends(obj: dict[str, Any]) -> list[tuple[str, str | None]]:
    spec = obj.get("spec") or {}
    found: list[tuple[str, str | None]] = []

    def service_name(backend: dict[str, Any]) -> str | None:
        return (backend.get("service") or {}).get("name") or backend.get("serviceName")

    if name := service_name(spec.get("defaultBackend") or spec.get("backend") or {}):
        found.append((name, "default"))
    for rule in spec.get("rules") or []:
        for path in ((rule.get("http") or {}).get("paths")) or []:
            if name := service_name(path.get("backend") or {}):
                found.append((name, f"{rule.get('host', '')}{path.get('path', '')}" or None))
    return found


def kubernetes_to_mermaid(source: str) -> str | None:
    if len(re.findall(r"(?:^|[\s\[,:])\*[A-Za-z_]", source)) > _MAX_ALIASES:
        return None  # alias-heavy YAML can expand exponentially
    try:
        documents = [doc for doc in yaml.safe_load_all(source) if isinstance(doc, dict)]
    except yaml.YAMLError:
        return None
    items: list[dict[str, Any]] = []
    for doc in documents:
        if doc.get("kind") == "List" and isinstance(doc.get("items"), list):
            items.extend(item for item in doc["items"] if isinstance(item, dict))
        else:
            items.append(doc)
    objects = [obj for obj in items if isinstance(obj.get("kind"), str) and isinstance((obj.get("metadata") or {}).get("name"), str)]
    if not objects:
        return None

    def namespace(obj: dict[str, Any]) -> str:
        return (obj.get("metadata") or {}).get("namespace") or "default"

    index = {(obj["kind"], namespace(obj), obj["metadata"]["name"]): f"K{number}" for number, obj in enumerate(objects, start=1)}
    by_id = {index[(obj["kind"], namespace(obj), obj["metadata"]["name"])]: obj for obj in objects}
    links: list[tuple[str, str, str | None]] = []

    for obj in objects:
        kind, ns, name = obj["kind"], namespace(obj), obj["metadata"]["name"]
        me = index[(kind, ns, name)]
        if kind == "Ingress":
            for backend, text in _ingress_backends(obj):
                if target := index.get(("Service", ns, backend)):
                    links.append((me, target, text))
        elif kind == "Service":
            selector = (obj.get("spec") or {}).get("selector") or {}
            if selector:
                for other in objects:
                    if other["kind"] in _WORKLOADS and namespace(other) == ns:
                        pod_labels = _pod_labels(other)
                        if all(pod_labels.get(key) == value for key, value in selector.items()):
                            links.append((me, index[(other["kind"], ns, other["metadata"]["name"])], None))
        elif kind == "HorizontalPodAutoscaler":
            ref = (obj.get("spec") or {}).get("scaleTargetRef") or {}
            if target := index.get((ref.get("kind"), ns, ref.get("name"))):
                links.append((me, target, "scales"))
        if kind in _WORKLOADS:
            for ref_kind, ref_name in _pod_references(_pod_spec(obj)):
                if target := index.get((ref_kind, ns, ref_name)):
                    links.append((target, me, "uses" if ref_kind == "ServiceAccount" else None))

    namespaces = {namespace(obj) for obj in objects}
    out = ["flowchart LR"]
    grouped: dict[str, list[str]] = defaultdict(list)
    for identifier, obj in by_id.items():
        grouped[namespace(obj)].append(identifier)

    def line(identifier: str, pad: str) -> str:
        obj = by_id[identifier]
        return pad + node(identifier, f"{obj['kind']}\n{obj['metadata']['name']}", _SHAPES.get(obj["kind"], "rect"))

    if len(namespaces) > 1:
        for ns, identifiers in grouped.items():
            out.append(f'    subgraph ns_{re.sub(r"[^A-Za-z0-9_]", "_", ns)}["namespace: {label(ns)}"]')
            out.extend(line(identifier, "        ") for identifier in identifiers)
            out.append("    end")
    else:
        out.extend(line(identifier, "    ") for identifier in by_id)

    seen: set[tuple[str, str]] = set()
    for source_id, target_id, text in links:
        if (source_id, target_id) not in seen:
            seen.add((source_id, target_id))
            out.append("    " + edge(source_id, target_id, text))
    return "\n".join(out)
