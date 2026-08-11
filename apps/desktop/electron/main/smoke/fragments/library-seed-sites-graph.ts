export const smokeLibrarySeedSitesGraph = String.raw`            await window.aura.db.run(
              "INSERT OR IGNORE INTO discovery_sites (id, name, home_url, search_url, builtin, hidden, sort_order, use_proxy, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 0, ?, 0, ?, ?)",
              [
                DISCOVERY_SITE_SMOKE.id,
                DISCOVERY_SITE_SMOKE.name,
                DISCOVERY_SITE_SMOKE.homeUrl,
                DISCOVERY_SITE_SMOKE.searchUrl,
                990,
                now,
                now
              ]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO discovery_sites (id, name, home_url, search_url, builtin, hidden, sort_order, use_proxy, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 0, ?, 0, ?, ?)",
              [
                REMOVABLE_DISCOVERY_SITE_SMOKE.id,
                REMOVABLE_DISCOVERY_SITE_SMOKE.name,
                REMOVABLE_DISCOVERY_SITE_SMOKE.homeUrl,
                REMOVABLE_DISCOVERY_SITE_SMOKE.searchUrl,
                991,
                now,
                now
              ]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO discovery_sites (id, name, home_url, search_url, builtin, hidden, sort_order, use_proxy, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 1, ?, 0, ?, ?)",
              [
                HIDDEN_DISCOVERY_SITE_SMOKE.id,
                HIDDEN_DISCOVERY_SITE_SMOKE.name,
                HIDDEN_DISCOVERY_SITE_SMOKE.homeUrl,
                HIDDEN_DISCOVERY_SITE_SMOKE.searchUrl,
                992,
                now,
                now
              ]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO discovery_sites (id, name, home_url, search_url, builtin, hidden, sort_order, use_proxy, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 1, ?, 0, ?, ?)",
              [
                MANUAL_HIDDEN_DISCOVERY_SITE_SMOKE.id,
                MANUAL_HIDDEN_DISCOVERY_SITE_SMOKE.name,
                MANUAL_HIDDEN_DISCOVERY_SITE_SMOKE.homeUrl,
                MANUAL_HIDDEN_DISCOVERY_SITE_SMOKE.searchUrl,
                993,
                now,
                now
              ]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO attachments (id, work_id, kind, sha256, byte_size, original_filename, fetched_via, page_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
              [
                BROKEN_BLOB.attachmentId,
                BROKEN_BLOB.workId,
                "pdf",
                BROKEN_BLOB.sha,
                1234,
                "missing-local-blob.pdf",
                "smoke",
                1,
                now,
                now
              ]
            );
            const corruptBytes = new TextEncoder().encode("this is not a pdf");
            const stagedCorruptPdf = await window.aura.data.command("library.stagePdf", { bytes: corruptBytes });
            const corruptSha = stagedCorruptPdf.sha;
            await window.aura.db.run(
              "INSERT OR IGNORE INTO attachments (id, work_id, kind, sha256, byte_size, original_filename, fetched_via, page_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
              [
                CORRUPT_PDF.attachmentId,
                CORRUPT_PDF.workId,
                "pdf",
                corruptSha,
                corruptBytes.byteLength,
                "corrupt-local-pdf.pdf",
                "smoke",
                1,
                now,
                now
              ]
            );
            await window.aura.db.run(
              "INSERT OR REPLACE INTO graph_cache (work_id, payload_json, fetched_at) VALUES (?, ?, ?)",
              [
                SAMPLE.doi,
                JSON.stringify({
                  centerId: "WsmokeReaderGraphCenter",
                  nodes: [
                    {
                      id: "WsmokeReaderGraphCenter",
                      title: SAMPLE.title,
                      year: 2026,
                      citedByCount: 9,
                      doi: SAMPLE.doi,
                      venue: SAMPLE.venue,
                      firstAuthor: SAMPLE.author,
                      relation: "center"
                    }
                  ],
                  edges: [],
                  truncated: false
                }),
                now
              ]
            );
            await window.aura.db.run(
              "INSERT OR REPLACE INTO graph_cache (work_id, payload_json, fetched_at) VALUES (?, ?, ?)",
              [
                GRAPH_SMOKE.centerDoi,
                JSON.stringify({
                  centerId: "WsmokeGraphCenter",
                  nodes: [
                    {
                      id: "WsmokeGraphCenter",
                      title: GRAPH_SMOKE.centerTitle,
                      year: 2024,
                      citedByCount: 12,
                      doi: GRAPH_SMOKE.centerDoi,
                      venue: "Smoke Graph Journal",
                      firstAuthor: "Graph Center",
                      relation: "center"
                    },
                    {
                      id: "WsmokeGraphReference",
                      title: GRAPH_SMOKE.referenceTitle,
                      year: 2021,
                      citedByCount: 3,
                      doi: GRAPH_SMOKE.referenceDoi,
                      venue: "Smoke Reference Journal",
                      firstAuthor: "Graph Reference",
                      relation: "reference"
                    },
                    {
                      id: "WsmokeGraphImportSuccess",
                      title: GRAPH_SMOKE.successTitle,
                      year: 2025,
                      citedByCount: 7,
                      doi: GRAPH_SMOKE.successDoi,
                      venue: "Smoke Import Journal",
                      firstAuthor: "Graph Success",
                      relation: "citer"
                    }
                  ],
                  edges: [
                    { source: "WsmokeGraphCenter", target: "WsmokeGraphReference" },
                    { source: "WsmokeGraphImportSuccess", target: "WsmokeGraphCenter" }
                  ],
                  truncated: false
                }),
                now
              ]
            );
            await window.aura.db.run(
              "INSERT OR REPLACE INTO graph_cache (work_id, payload_json, fetched_at) VALUES (?, ?, ?)",
              [
                GRAPH_SMOKE.raceOldDoi,
                JSON.stringify({
                  centerId: "WsmokeGraphRaceOld",
                  nodes: [
                    {
                      id: "WsmokeGraphRaceOld",
                      title: GRAPH_SMOKE.raceOldTitle,
                      year: 2023,
                      citedByCount: 1,
                      doi: GRAPH_SMOKE.raceOldDoi,
                      venue: "Smoke Graph Race Journal",
                      firstAuthor: "Graph Race Old",
                      relation: "center"
                    }
                  ],
                  edges: [],
                  truncated: false
                }),
                now
              ]
            );
            await window.aura.db.run(
              "INSERT OR REPLACE INTO graph_cache (work_id, payload_json, fetched_at) VALUES (?, ?, ?)",
              [
                GRAPH_SMOKE.raceNewDoi,
                JSON.stringify({
                  centerId: "WsmokeGraphRaceNew",
                  nodes: [
                    {
                      id: "WsmokeGraphRaceNew",
                      title: GRAPH_SMOKE.raceNewTitle,
                      year: 2026,
                      citedByCount: 2,
                      doi: GRAPH_SMOKE.raceNewDoi,
                      venue: "Smoke Graph Race Journal",
                      firstAuthor: "Graph Race New",
                      relation: "center"
                    }
                  ],
                  edges: [],
                  truncated: false
                }),
                now
              ]
            );
            await window.aura.db.run(
              "INSERT OR REPLACE INTO graph_cache (work_id, payload_json, fetched_at) VALUES (?, ?, ?)",
              [
                GRAPH_SMOKE.deepLinkDoi,
                JSON.stringify({
                  centerId: "WsmokeGraphDeepLink",
                  nodes: [
                    {
                      id: "WsmokeGraphDeepLink",
                      title: GRAPH_SMOKE.deepLinkTitle,
                      year: 2027,
                      citedByCount: 5,
                      doi: GRAPH_SMOKE.deepLinkDoi,
                      venue: "Smoke Graph Deep Link Journal",
                      firstAuthor: "Graph Deep Link",
                      relation: "center"
                    }
                  ],
                  edges: [],
                  truncated: false
                }),
                now
              ]
            );
            await window.aura.db.exec("COMMIT");
          } catch (error) {
            await window.aura.db.exec("ROLLBACK");
            throw error;
          }

`;
