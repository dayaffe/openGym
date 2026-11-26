#!/usr/bin/env python3
"""Build a SideStore/AltStore source entry for an unsigned openGym IPA."""
from __future__ import annotations

import argparse
import json
import plistlib
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse


def https_url(value: str, label: str) -> str:
    if urlparse(value).scheme != "https":
        raise SystemExit(f"{label} must be an HTTPS URL")
    return value


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ipa", type=Path, required=True)
    parser.add_argument("--repository", required=True, help="GitHub owner/name")
    parser.add_argument("--download-url", required=True)
    parser.add_argument("--icon-url", required=True)
    parser.add_argument("--source-url", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    if not args.ipa.is_file():
        raise SystemExit(f"IPA not found: {args.ipa}")
    try:
        owner, repo_name = args.repository.split("/", 1)
    except ValueError as exc:
        raise SystemExit("--repository must be in owner/name form") from exc

    try:
        with zipfile.ZipFile(args.ipa) as ipa:
            info = plistlib.loads(ipa.read("Payload/App.app/Info.plist"))
    except (OSError, KeyError, zipfile.BadZipFile, plistlib.InvalidFileException) as exc:
        raise SystemExit(f"could not read Payload/App.app/Info.plist from {args.ipa}: {exc}") from exc

    version = info.get("CFBundleShortVersionString")
    bundle_id = info.get("CFBundleIdentifier")
    min_os = info.get("MinimumOSVersion")
    if not version or not bundle_id:
        raise SystemExit("IPA is missing CFBundleShortVersionString or CFBundleIdentifier")

    download_url = https_url(args.download_url, "download URL")
    icon_url = https_url(args.icon_url, "icon URL")
    source_url = https_url(args.source_url, "source URL")
    release_date = datetime.now(timezone.utc).date().isoformat()
    ipa_size = args.ipa.stat().st_size

    release = {
        "version": version,
        "date": release_date,
        "downloadURL": download_url,
        "size": ipa_size,
        "localizedDescription": (
            f"Unofficial unsigned SideStore build from {args.repository}. "
            "SideStore signs this IPA with your Apple ID. It keeps openGym's original "
            "iOS bundle identifier and cannot be installed alongside another build "
            "with that identifier."
        ),
    }
    if min_os:
        release["minOSVersion"] = str(min_os)

    app = {
        "name": "openGym",
        "bundleIdentifier": bundle_id,
        "developerName": f"dayaffe (unofficial fork of {owner}/{repo_name})",
        "iconURL": icon_url,
        "subtitle": "A local-first workout tracker",
        "localizedDescription": (
            f"Unofficial SideStore build of openGym from {args.repository}. "
            "This IPA is unsigned; SideStore signs it with your Apple ID. "
            "Your training data stays on your device unless you choose to connect "
            "to a server you control. This fork retains openGym's original iOS bundle "
            "identifier, so it cannot be installed alongside another build with that identifier."
        ),
        # Keep these legacy fields for older AltStore/SideStore clients. SideStore's
        # current schema uses versions[]; some clients still require app-level downloadURL.
        "downloadURL": download_url,
        "version": version,
        "versionDate": release_date,
        "size": ipa_size,
        "versions": [release],
    }

    source = {
        "name": f"{owner}/{repo_name} SideStore",
        "identifier": f"io.github.{owner}.{repo_name}.sidestore".lower(),
        "sourceURL": source_url,
        "apps": [app],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(source, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
