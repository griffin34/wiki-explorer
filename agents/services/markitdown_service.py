from __future__ import annotations

import logging
from dataclasses import dataclass
from email import policy
from email.parser import BytesParser
from pathlib import Path

logger = logging.getLogger(__name__)


@dataclass
class ConversionResult:
    text: str
    title: str
    source_type: str


def _parse_eml_file(file_path: Path) -> tuple[str, str]:
    """Parse an .eml file using Python's email library and extract content as markdown."""
    with open(file_path, "rb") as f:
        msg = BytesParser(policy=policy.default).parse(f)
    
    # Extract headers
    subject = msg.get("Subject", "")
    from_addr = msg.get("From", "")
    to_addr = msg.get("To", "")
    date = msg.get("Date", "")
    
    # Build markdown output
    lines = ["# Email Message", ""]
    if subject:
        lines.append(f"**Subject:** {subject}")
    if from_addr:
        lines.append(f"**From:** {from_addr}")
    if to_addr:
        lines.append(f"**To:** {to_addr}")
    if date:
        lines.append(f"**Date:** {date}")
    
    lines.extend(["", "---", ""])
    
    # Get body content - prefer plain text, fall back to HTML
    # Skip image/binary parts entirely
    body = ""
    if msg.is_multipart():
        for part in msg.walk():
            content_type = part.get_content_type()
            # Skip binary content types
            if content_type.startswith(("image/", "audio/", "video/", "application/")):
                continue
            try:
                if content_type == "text/plain":
                    content = part.get_content()
                    if isinstance(content, str):
                        body = content
                        break
                elif content_type == "text/html" and not body:
                    content = part.get_content()
                    if isinstance(content, str):
                        body = _html_to_text(content)
            except Exception as exc:
                logger.debug("Skipping email part %s: %s", content_type, exc)
                continue
    else:
        try:
            content = msg.get_content()
            if isinstance(content, str):
                if msg.get_content_type() == "text/html":
                    body = _html_to_text(content)
                else:
                    body = content
        except Exception as exc:
            logger.warning("Failed to get email content: %s", exc)
    
    if body:
        lines.append(body)
    
    title = subject if subject else file_path.stem
    return "\n".join(lines), title


def _html_to_text(html: str) -> str:
    """Basic HTML to plain text conversion."""
    import re
    # Remove base64 data URLs (embedded images, etc.)
    text = re.sub(r"data:[^;]+;base64,[A-Za-z0-9+/=]+", "[image]", html)
    # Remove img tags entirely (may contain CID references)
    text = re.sub(r"<img[^>]*>", "", text, flags=re.IGNORECASE)
    # Remove script and style elements
    text = re.sub(r"<(script|style)[^>]*>.*?</\1>", "", text, flags=re.DOTALL | re.IGNORECASE)
    # Convert common block elements to newlines
    text = re.sub(r"<(br|p|div|h[1-6]|li)[^>]*>", "\n", text, flags=re.IGNORECASE)
    # Remove remaining HTML tags
    text = re.sub(r"<[^>]+>", "", text)
    # Decode common HTML entities
    text = text.replace("&nbsp;", " ").replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
    # Remove any remaining long base64-like strings (safety net)
    text = re.sub(r"[A-Za-z0-9+/]{100,}={0,2}", "[binary data removed]", text)
    # Normalize whitespace
    text = re.sub(r"\n\s*\n", "\n\n", text)
    text = re.sub(r"[ \t]+", " ", text)
    return text.strip()


def _parse_mhtml_file(file_path: Path) -> tuple[str, str]:
    """Parse an .mhtml/.mht file (web archive format)."""
    with open(file_path, "rb") as f:
        msg = BytesParser(policy=policy.default).parse(f)
    
    # MHTML is MIME encoded - find the HTML part
    subject = msg.get("Subject", "")
    title = subject if subject else file_path.stem
    
    html_content = ""
    if msg.is_multipart():
        for part in msg.walk():
            if part.get_content_type() == "text/html":
                html_content = part.get_content()
                break
    else:
        html_content = msg.get_content()
    
    if html_content:
        text = _html_to_text(html_content)
    else:
        text = "Unable to extract content from MHTML file."
    
    return text, title


class MarkItDownService:
    def __init__(self) -> None:
        self._md = None  # lazy init

    def _get_converter(self):
        if self._md is None:
            from markitdown import MarkItDown

            self._md = MarkItDown()
        return self._md

    def convert(self, file_path: str | Path) -> ConversionResult:
        """Convert a file to Markdown. Raises RuntimeError on failure."""
        file_path = Path(file_path)
        source_type = file_path.suffix.lstrip(".").lower() or "unknown"
        
        # Use built-in email parser for .eml files
        if source_type == "eml":
            try:
                text, title = _parse_eml_file(file_path)
                return ConversionResult(text=text, title=title, source_type=source_type)
            except Exception as exc:
                logger.warning(f"Built-in .eml parser failed, trying MarkItDown: {exc}")
                # Fall through to MarkItDown
        
        # Use built-in parser for .mhtml/.mht files (web archives)
        if source_type in ("mhtml", "mht"):
            try:
                text, title = _parse_mhtml_file(file_path)
                return ConversionResult(text=text, title=title, source_type=source_type)
            except Exception as exc:
                logger.warning(f"Built-in .mhtml parser failed, trying MarkItDown: {exc}")
                # Fall through to MarkItDown
        
        try:
            result = self._get_converter().convert(str(file_path))
            text = result.text_content or ""
            title = getattr(result, "title", None) or file_path.stem
            return ConversionResult(text=text, title=str(title), source_type=source_type)
        except Exception as exc:
            raise RuntimeError(
                f"MarkItDown conversion failed for {file_path.name}: {exc}"
            ) from exc
