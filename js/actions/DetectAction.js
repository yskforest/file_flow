// Detect Action
(function () {
    const BaseAction = FileFlow.actions.BaseAction;
    const FileSystem = FileFlow.utils.FileSystem;

    class DetectAction extends BaseAction {
        constructor() {
            super('detect', 'Detect Info');
        }

        shouldApply(entry, filename) {
            return !entry.isDirectory;
        }

        async execute(itemDiv, entry) {
            const file = await new Promise((resolve, reject) => {
                entry.file(resolve, reject);
            });

            // Read first 4KB for detection (enough for most headers/BOMs)
            const buffer = await FileSystem.readFileSliceAsArrayBuffer(file, 0, 4096);
            const view = new Uint8Array(buffer);

            // 1. EOL Detection
            let cr = 0, lf = 0, crlf = 0;
            for (let j = 0; j < view.length; j++) {
                if (view[j] === 0x0D) { // CR
                    if (j + 1 < view.length && view[j + 1] === 0x0A) {
                        crlf++;
                        j++; // Skip LF
                    } else {
                        cr++;
                    }
                } else if (view[j] === 0x0A) { // LF
                    lf++;
                }
            }

            let eol = 'Unknown';
            if (crlf > lf && crlf > cr) eol = 'CRLF';
            else if (lf > crlf && lf > cr) eol = 'LF';
            else if (cr > crlf && cr > lf) eol = 'CR';
            else if (crlf === 0 && lf === 0 && cr === 0) eol = 'None';
            else eol = 'Mixed';

            // 2. Encoding Detection (Heuristic)
            let encoding = 'Unknown';

            // BOM Checks
            if (view.length >= 3 && view[0] === 0xEF && view[1] === 0xBB && view[2] === 0xBF) {
                encoding = 'UTF-8 (BOM)';
            } else if (view.length >= 2 && view[0] === 0xFE && view[1] === 0xFF) {
                encoding = 'UTF-16 BE';
            } else if (view.length >= 2 && view[0] === 0xFF && view[1] === 0xFE) {
                encoding = 'UTF-16 LE';
            } else {
                // No BOM, try to validate patterns

                // Check for pure ASCII first
                let isAscii = true;
                for (let j = 0; j < view.length; j++) {
                    if (view[j] > 0x7F) {
                        isAscii = false;
                        break;
                    }
                }

                if (isAscii) {
                    encoding = 'ASCII'; // Subset of UTF-8
                } else {
                    // Try UTF-8 validation
                    let isUtf8 = true;
                    try {
                        new TextDecoder('utf-8', { fatal: true }).decode(view);
                    } catch (e) {
                        isUtf8 = false;
                    }

                    if (isUtf8) {
                        encoding = 'UTF-8';
                    } else {
                        // Try Shift_JIS (Simple heuristics for valid ranges)
                        // Shift_JIS: 0x81-0x9F, 0xE0-0xFC (Lead bytes)
                        let looksLikeSJIS = false;
                        let validSJIS = true;
                        for (let j = 0; j < view.length; j++) {
                            const b = view[j];
                            if ((b >= 0x81 && b <= 0x9F) || (b >= 0xE0 && b <= 0xFC)) {
                                // Lead byte
                                looksLikeSJIS = true;
                                if (j + 1 >= view.length) break; // Incomplete
                                const b2 = view[j + 1];
                                if ((b2 >= 0x40 && b2 <= 0x7E) || (b2 >= 0x80 && b2 <= 0xFC)) {
                                    j++;
                                } else {
                                    validSJIS = false;
                                    break;
                                }
                            } else if (b >= 0xFD) {
                                validSJIS = false;
                                break;
                            }
                        }

                        if (looksLikeSJIS && validSJIS) {
                            encoding = 'Shift_JIS';
                        } else {
                            // Try EUC-JP (Lead 0x8E, 0x8F, or A1-FE)
                            // Very simplified check
                            let looksLikeEUC = false;
                            for (let j = 0; j < view.length; j++) {
                                const b = view[j];
                                if (b >= 0xA1 && b <= 0xFE) {
                                    looksLikeEUC = true;
                                }
                            }
                            if (looksLikeEUC) encoding = 'EUC-JP?'; // Weak guess
                        }
                    }
                }
            }

            // Update UI
            const nameSpan = itemDiv.querySelector('.file-name');

            // Remove existing badges if any
            const existingBadges = itemDiv.querySelectorAll('.info-badge');
            existingBadges.forEach(b => b.remove());

            if (nameSpan) {
                const badgeEnc = document.createElement('span');
                badgeEnc.className = 'info-badge enc';
                badgeEnc.textContent = encoding;
                badgeEnc.style.cssText = "background: rgba(56, 189, 248, 0.2); color: #38bdf8; padding: 2px 6px; border-radius: 4px; font-size: 0.75rem; margin-left: 8px; font-family: monospace;";

                const badgeEol = document.createElement('span');
                badgeEol.className = 'info-badge eol';
                badgeEol.textContent = eol;
                badgeEol.style.cssText = "background: rgba(168, 85, 247, 0.2); color: #c084fc; padding: 2px 6px; border-radius: 4px; font-size: 0.75rem; margin-left: 4px; font-family: monospace;";

                nameSpan.after(badgeEol);
                nameSpan.after(badgeEnc); // Insert Enc before EOL
            }
        }
    }

    FileFlow.actions.DetectAction = DetectAction;
    FileFlow.actions.ActionManager.register(new DetectAction());

})();
