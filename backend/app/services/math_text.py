"""LaTeX to readable Unicode text, for formats that cannot typeset math (DOCX, PDF).

The HTML export keeps real MathML; here the goal is that no symbol or structure of the formula is lost.
"""
from __future__ import annotations

import re

_SYMBOLS = {
    "alpha": "α", "beta": "β", "gamma": "γ", "delta": "δ", "epsilon": "ε", "varepsilon": "ε", "zeta": "ζ", "eta": "η",
    "theta": "θ", "vartheta": "ϑ", "iota": "ι", "kappa": "κ", "lambda": "λ", "mu": "μ", "nu": "ν", "xi": "ξ", "pi": "π",
    "varpi": "ϖ", "rho": "ρ", "sigma": "σ", "varsigma": "ς", "tau": "τ", "upsilon": "υ", "phi": "φ", "varphi": "ϕ",
    "chi": "χ", "psi": "ψ", "omega": "ω", "Gamma": "Γ", "Delta": "Δ", "Theta": "Θ", "Lambda": "Λ", "Xi": "Ξ", "Pi": "Π",
    "Sigma": "Σ", "Upsilon": "Υ", "Phi": "Φ", "Psi": "Ψ", "Omega": "Ω",
    "sum": "∑", "prod": "∏", "int": "∫", "iint": "∬", "oint": "∮", "infty": "∞", "partial": "∂", "nabla": "∇",
    "pm": "±", "mp": "∓", "times": "×", "div": "÷", "cdot": "·", "ast": "∗", "star": "⋆", "circ": "∘", "bullet": "•",
    "leq": "≤", "le": "≤", "geq": "≥", "ge": "≥", "neq": "≠", "ne": "≠", "approx": "≈", "equiv": "≡", "sim": "∼",
    "simeq": "≃", "cong": "≅", "propto": "∝", "ll": "≪", "gg": "≫",
    "in": "∈", "notin": "∉", "ni": "∋", "subset": "⊂", "supset": "⊃", "subseteq": "⊆", "supseteq": "⊇",
    "cup": "∪", "cap": "∩", "emptyset": "∅", "varnothing": "∅", "setminus": "∖",
    "forall": "∀", "exists": "∃", "nexists": "∄", "neg": "¬", "lnot": "¬", "land": "∧", "wedge": "∧", "lor": "∨", "vee": "∨",
    "to": "→", "rightarrow": "→", "leftarrow": "←", "leftrightarrow": "↔", "Rightarrow": "⇒", "Leftarrow": "⇐",
    "Leftrightarrow": "⇔", "implies": "⟹", "iff": "⟺", "mapsto": "↦", "uparrow": "↑", "downarrow": "↓",
    "ldots": "…", "cdots": "⋯", "vdots": "⋮", "ddots": "⋱", "dots": "…", "prime": "′", "angle": "∠", "perp": "⊥",
    "parallel": "∥", "degree": "°", "hbar": "ℏ", "ell": "ℓ", "Re": "ℜ", "Im": "ℑ", "aleph": "ℵ",
    "langle": "⟨", "rangle": "⟩", "lceil": "⌈", "rceil": "⌉", "lfloor": "⌊", "rfloor": "⌋",
    "log": "log", "ln": "ln", "sin": "sin", "cos": "cos", "tan": "tan", "exp": "exp", "min": "min", "max": "max",
    "lim": "lim", "det": "det", "gcd": "gcd", "sup": "sup", "inf": "inf", "arg": "arg", "mod": "mod", "bmod": "mod",
}

_BLACKBOARD = {"R": "ℝ", "N": "ℕ", "Z": "ℤ", "Q": "ℚ", "C": "ℂ", "P": "ℙ", "H": "ℍ", "E": "𝔼"}
_SUPERSCRIPT = dict(zip("0123456789+-=()ni", "⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁿⁱ"))
_SUBSCRIPT = dict(zip("0123456789+-=()aeoxhklmnpst", "₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎ₐₑₒₓₕₖₗₘₙₚₛₜ"))


def _group(text: str, start: int) -> tuple[str, int]:
    """The `{...}` group (or single token) starting at `start`, and the index after it."""
    while start < len(text) and text[start] == " ":
        start += 1
    if start >= len(text):
        return "", start
    if text[start] == "{":
        depth = 0
        for index in range(start, len(text)):
            if text[index] == "{":
                depth += 1
            elif text[index] == "}":
                depth -= 1
                if depth == 0:
                    return text[start + 1:index], index + 1
        return text[start + 1:], len(text)
    if text[start] == "\\":
        match = re.match(r"\\([A-Za-z]+|.)", text[start:])
        return (match.group(0), start + len(match.group(0))) if match else (text[start], start + 1)
    return text[start], start + 1


def _script(body: str, table: dict[str, str], marker: str) -> str:
    if body and all(char in table for char in body):
        return "".join(table[char] for char in body)
    return f"{marker}({body})" if len(body) > 1 else f"{marker}{body}"


def tex_to_text(tex: str) -> str:
    text = tex.strip()
    out: list[str] = []
    index = 0
    while index < len(text):
        char = text[index]
        if char == "\\":
            match = re.match(r"\\([A-Za-z]+)\*?|\\(.)", text[index:])
            if not match:
                out.append(char)
                index += 1
                continue
            name = match.group(1)
            index += len(match.group(0))
            if name is None:
                symbol = match.group(2)
                out.append({",": " ", ";": " ", ":": " ", "!": "", " ": " ", "{": "{", "}": "}", "|": "‖", "\\": "\n"}.get(symbol, symbol))
            elif name == "frac" or name == "dfrac" or name == "tfrac":
                top, index = _group(text, index)
                bottom, index = _group(text, index)
                out.append(f"({tex_to_text(top)})/({tex_to_text(bottom)})")
            elif name == "sqrt":
                if text[index:index + 1] == "[":
                    end = text.find("]", index)
                    root, index = text[index + 1:end], end + 1
                    body, index = _group(text, index)
                    out.append(f"{_script(root, _SUPERSCRIPT, '^')}√({tex_to_text(body)})")
                else:
                    body, index = _group(text, index)
                    out.append(f"√({tex_to_text(body)})")
            elif name in ("text", "mathrm", "mathbf", "mathit", "mathsf", "mathtt", "operatorname", "textbf", "textit", "mbox", "boldsymbol", "mathcal", "mathscr"):
                body, index = _group(text, index)
                out.append(tex_to_text(body))
            elif name == "mathbb":
                body, index = _group(text, index)
                out.append("".join(_BLACKBOARD.get(c, c) for c in body))
            elif name in ("hat", "bar", "vec", "tilde", "dot", "overline", "underline", "widehat"):
                body, index = _group(text, index)
                mark = {"hat": "\u0302", "bar": "\u0304", "vec": "\u20d7", "tilde": "\u0303", "dot": "\u0307", "overline": "\u0305", "underline": "\u0332", "widehat": "\u0302"}[name]
                inner = tex_to_text(body)
                out.append(inner + mark if len(inner) == 1 else f"({inner})")
            elif name in ("left", "right", "big", "Big", "bigg", "Bigg", "displaystyle", "limits", "nolimits", "quad", "qquad", "begin", "end"):
                if name in ("quad", "qquad"):
                    out.append("  ")
                elif name in ("begin", "end"):
                    _, index = _group(text, index)
            elif name in _SYMBOLS:
                out.append(_SYMBOLS[name])
                if name in ("log", "ln", "sin", "cos", "tan", "exp", "min", "max", "lim", "det", "gcd", "sup", "inf", "arg") and index < len(text) and text[index] not in " ^_({":
                    out.append(" ")
            else:
                out.append(name)
        elif char == "^":
            body, index = _group(text, index + 1)
            out.append(_script(tex_to_text(body), _SUPERSCRIPT, "^"))
        elif char == "_":
            body, index = _group(text, index + 1)
            out.append(_script(tex_to_text(body), _SUBSCRIPT, "_"))
        elif char in "{}":
            index += 1
        elif char == "&":
            out.append("\t")
            index += 1
        elif char == "~":
            out.append(" ")
            index += 1
        else:
            out.append(char)
            index += 1
    return re.sub(r"[ ]{2,}", " ", "".join(out)).strip()
