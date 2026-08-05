from __future__ import annotations

import colorsys
import math
from pathlib import Path
from typing import Literal

from fastapi import FastAPI
from pydantic import BaseModel
from PIL import Image

app = FastAPI(title="AutoVlog AI Analysis Service", version="0.1.0")


class AnalyzeAsset(BaseModel):
    id: str
    mediaType: Literal["image", "video"]
    thumbnailPath: str
    proxyPath: str | None = None
    brightness: float
    contrast: float
    sharpness: float
    motion: float
    uniqueness: float
    durationSec: float


class BatchAnalyzeRequest(BaseModel):
    projectId: str
    assets: list[AnalyzeAsset]


class AnalyzeSuggestion(BaseModel):
    assetId: str
    qualityBoost: float
    semanticHint: str | None = None
    faceHint: float | None = None


class BatchAnalyzeResponse(BaseModel):
    suggestions: list[AnalyzeSuggestion]


class ChapterFeatures(BaseModel):
    chapterId: str
    avgMotion: float
    imageRatio: float
    videoRatio: float
    avgBrightness: float
    spanHours: float
    size: int


class LabelChapterRequest(BaseModel):
    projectId: str
    chapters: list[ChapterFeatures]


class ChapterLabel(BaseModel):
    chapterId: str
    title: str
    confidence: float


class LabelChapterResponse(BaseModel):
    labels: list[ChapterLabel]


class TranscribeAsset(BaseModel):
    assetId: str
    mediaType: Literal["image", "video"]
    originalPath: str
    durationSec: float


class TranscribeBatchRequest(BaseModel):
    projectId: str
    assets: list[TranscribeAsset]


class TranscriptionItem(BaseModel):
    assetId: str
    text: str | None = None
    snippet: str | None = None
    confidence: float
    source: Literal["whisper", "sidecar", "heuristic", "none"]
    events: list[str]


class TranscribeBatchResponse(BaseModel):
    transcriptions: list[TranscriptionItem]


def clamp(value: float, minimum: float = 0.0, maximum: float = 1.0) -> float:
    return max(minimum, min(maximum, value))


def colorfulness(image: Image.Image) -> float:
    rgb = image.convert("RGB")
    pixels = list(rgb.getdata())
    if not pixels:
        return 0.0
    saturation = []
    for red, green, blue in pixels[::8]:
        _hue, _lightness, sat = colorsys.rgb_to_hls(red / 255.0, green / 255.0, blue / 255.0)
        saturation.append(sat)
    return clamp(sum(saturation) / max(len(saturation), 1))


def entropy_score(image: Image.Image) -> float:
    histogram = image.convert("L").histogram()
    total = sum(histogram)
    if total == 0:
        return 0.0
    entropy = 0.0
    for count in histogram:
        if count == 0:
            continue
        probability = count / total
        entropy -= probability * math.log2(probability)
    return clamp(entropy / 8.0)


def centered_interest(image: Image.Image) -> float:
    rgb = image.convert("RGB")
    width, height = rgb.size
    if width == 0 or height == 0:
        return 0.0
    left = width * 0.25
    right = width * 0.75
    top = height * 0.2
    bottom = height * 0.8

    inside = []
    outside = []
    for y in range(height):
        for x in range(width):
            red, green, blue = rgb.getpixel((x, y))
            intensity = (red + green + blue) / (3 * 255.0)
            if left <= x <= right and top <= y <= bottom:
                inside.append(intensity)
            else:
                outside.append(intensity)

    if not inside or not outside:
        return 0.0

    inside_mean = sum(inside) / len(inside)
    outside_mean = sum(outside) / len(outside)
    return clamp(abs(inside_mean - outside_mean) * 1.4)


def safe_image_metrics(thumbnail_path: str) -> tuple[float, float, float]:
    path = Path(thumbnail_path)
    if not path.exists():
        return 0.0, 0.0, 0.0
    try:
        with Image.open(path) as image:
            image = image.copy()
        return entropy_score(image), colorfulness(image), centered_interest(image)
    except Exception:
        return 0.0, 0.0, 0.0


def semantic_hint(asset: AnalyzeAsset, entropy: float, color: float) -> str:
    if asset.motion > 0.6 and asset.mediaType == "video":
        return "high-energy"
    if asset.brightness < 0.38 and asset.mediaType == "image":
        return "moody-still"
    if asset.uniqueness > 0.7 and color > 0.45:
        return "highlight"
    if entropy > 0.55 and asset.durationSec > 6:
        return "story-beat"
    return "steady"


def clean_text(value: str) -> str:
    return " ".join(value.replace("_", " ").replace("-", " ").split())


def find_sidecar_text(original_path: str) -> str | None:
    base = Path(original_path)
    for extension in (".txt", ".srt", ".vtt"):
        candidate = base.with_suffix(extension)
        if candidate.exists():
            try:
                text = clean_text(candidate.read_text(encoding="utf-8", errors="ignore"))
                return text[:1200] if text else None
            except Exception:
                continue
    return None


def infer_events(text: str, fallback_name: str) -> list[str]:
    haystack = text.lower()
    events: list[str] = []
    if "laugh" in haystack or "lol" in haystack:
        events.append("laughter")
    if "cheer" in haystack or "crowd" in haystack:
        events.append("crowd-energy")
    if "applause" in haystack or "clap" in haystack:
        events.append("applause")
    if "sing" in haystack or "music" in haystack:
        events.append("singalong")
    return events


def heuristic_transcript(path: Path) -> str | None:
    stem = clean_text(path.stem)
    words = [word for word in stem.split() if len(word) > 1 and not word.isdigit()]
    if not words:
        return None
    if len(words) <= 5:
        return " ".join(word.capitalize() for word in words)
    return " ".join(word.capitalize() for word in words[:7])


def build_transcription(asset: TranscribeAsset) -> TranscriptionItem:
    original_path = Path(asset.originalPath)
    sidecar = find_sidecar_text(asset.originalPath)
    if sidecar:
        snippet = " ".join(sidecar.split()[:12])
        return TranscriptionItem(
            assetId=asset.assetId,
            text=sidecar,
            snippet=snippet,
            confidence=0.74,
            source="sidecar",
            events=infer_events(sidecar, original_path.name),
        )

    return TranscriptionItem(
        assetId=asset.assetId,
        text=None,
        snippet=None,
        confidence=0.0,
        source="none",
        events=[],
    )


@app.get("/health")
def health_check() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/analyze/batch", response_model=BatchAnalyzeResponse)
def analyze_batch(request: BatchAnalyzeRequest) -> BatchAnalyzeResponse:
    suggestions: list[AnalyzeSuggestion] = []
    for asset in request.assets:
        entropy, color, center_interest = safe_image_metrics(asset.thumbnailPath)
        quality_boost = clamp(
            entropy * 0.32
            + color * 0.18
            + center_interest * 0.14
            + asset.uniqueness * 0.12
            + asset.motion * 0.08
        )
        face_hint = clamp(center_interest * 0.65 + color * 0.2)
        suggestions.append(
            AnalyzeSuggestion(
                assetId=asset.id,
                qualityBoost=quality_boost,
                semanticHint=semantic_hint(asset, entropy, color),
                faceHint=face_hint,
            )
        )
    return BatchAnalyzeResponse(suggestions=suggestions)


def chapter_title(index: int, chapter: ChapterFeatures) -> tuple[str, float]:
    if chapter.spanHours > 24:
        return "Trips", 0.83
    if chapter.avgMotion > 0.55 and chapter.videoRatio > 0.5:
        return "Social Life", 0.8
    if chapter.imageRatio > 0.6 and chapter.avgBrightness < 0.45:
        return "Late Night", 0.72
    if chapter.avgMotion < 0.24 and chapter.imageRatio > 0.45:
        return "Classes", 0.68
    if chapter.size >= 28:
        return "Move-In", 0.64
    return f"Chapter {index + 1}", 0.42


@app.post("/label/chapters", response_model=LabelChapterResponse)
def label_chapters(request: LabelChapterRequest) -> LabelChapterResponse:
    labels = []
    for index, chapter in enumerate(request.chapters):
        title, confidence = chapter_title(index, chapter)
        labels.append(
            ChapterLabel(
                chapterId=chapter.chapterId,
                title=title,
                confidence=confidence,
            )
        )
    return LabelChapterResponse(labels=labels)


@app.post("/transcribe/batch", response_model=TranscribeBatchResponse)
def transcribe_batch(request: TranscribeBatchRequest) -> TranscribeBatchResponse:
    return TranscribeBatchResponse(
        transcriptions=[build_transcription(asset) for asset in request.assets]
    )
