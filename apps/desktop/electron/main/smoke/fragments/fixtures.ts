export const smokeFixtures = String.raw`
      (async () => {
        const SAMPLE = {
          author: "Ada Lovelace",
          attachmentId: "smoke-attachment-pdf",
          doi: "10.4242/aurascholar.smoke",
          pmid: "42000042",
          tag: "Smoke QA",
          title: "Extreme Consumer Research Experience",
          venue: "Journal of Product-Grade Research",
          workId: "smoke-work-extreme-c-ux",
          authorId: "smoke-author-ada",
          annotationId: "smoke-annotation-reader-delete-confirm",
          tagId: "smoke-tag-qa"
        };
        const READER_ANNOTATION_DELETE_FAILURE_SMOKE = {
          error: "Smoke reader annotation delete failure"
        };
        const READER_ANNOTATION_RESTORE_FAILURE_SMOKE = {
          error: "Smoke reader annotation restore failure"
        };
        const LIBRARY_SENTINEL_LINK_SMOKE = {
          id: "smoke-sentinel-library-link",
          doi: SAMPLE.doi,
          title: SAMPLE.title
        };
        const TAG_MANAGER_SMOKE = {
          id: "smoke-tag-manager-action",
          name: "Smoke Tag Manager Action",
          color: "#0f766e"
        };
        const TAG_RENAME_FAILURE_SMOKE = {
          name: "Smoke Tag Rename Failure",
          error: "Smoke tag rename failure"
        };
        const TAG_DELETE_FAILURE_SMOKE = {
          error: "Smoke tag delete failure"
        };
        const TAG_RESTORE_FAILURE_SMOKE = {
          error: "Smoke tag restore failure"
        };
        const COLLECTION_MANAGER_SMOKE = {
          id: "smoke-collection-manager-action",
          name: "Smoke Collection Manager Action"
        };
        const COLLECTION_CREATE_FAILURE_SMOKE = {
          name: "Smoke Collection Create Failure",
          error: "Smoke collection create failure"
        };
        const COLLECTION_RENAME_FAILURE_SMOKE = {
          name: "Smoke Collection Rename Failure",
          error: "Smoke collection rename failure"
        };
        const COLLECTION_DELETE_FAILURE_SMOKE = {
          error: "Smoke collection delete failure"
        };
        const COLLECTION_RESTORE_FAILURE_SMOKE = {
          error: "Smoke collection restore failure"
        };
        const MOVE_COLLECTION_SMOKE = {
          id: "smoke-collection-move-target",
          name: "Smoke Move Target"
        };
        const MOVE_COLLECTION_FAILURE_SMOKE = {
          error: "Smoke move collection rollback failure",
          query: "Atomic Move Failure",
          works: [
            {
              author: "Emmy Noether",
              doi: "10.4242/aurascholar.move-failure-a",
              title: "Atomic Move Failure Alpha",
              venue: "Journal of Reliable Collections",
              workId: "smoke-work-move-failure-a",
              authorId: "smoke-author-emmy"
            },
            {
              author: "Ada Lovelace",
              doi: "10.4242/aurascholar.move-failure-b",
              title: "Atomic Move Failure Beta",
              venue: "Journal of Reliable Collections",
              workId: "smoke-work-move-failure-b",
              authorId: "smoke-author-ada-move"
            }
          ]
        };
        const BULK_TAG_SMOKE = {
          name: "Smoke Bulk Tag"
        };
        const BULK_TAG_FAILURE_SMOKE = {
          error: "Smoke bulk tag rollback failure",
          name: "Smoke Bulk Tag Failure",
          query: "Atomic Bulk Tag Failure",
          works: [
            {
              author: "Katherine Johnson",
              doi: "10.4242/aurascholar.bulk-tag-failure-a",
              title: "Atomic Bulk Tag Failure Alpha",
              venue: "Journal of Reliable Tagging",
              workId: "smoke-work-bulk-tag-failure-a",
              authorId: "smoke-author-katherine-tag"
            },
            {
              author: "Dorothy Vaughan",
              doi: "10.4242/aurascholar.bulk-tag-failure-b",
              title: "Atomic Bulk Tag Failure Beta",
              venue: "Journal of Reliable Tagging",
              workId: "smoke-work-bulk-tag-failure-b",
              authorId: "smoke-author-dorothy"
            }
          ]
        };
        const MERGE_SMOKE = {
          primaryId: "smoke-work-merge-primary",
          primaryTitle: "Smoke Merge Primary Paper",
          primaryDoi: "10.4242/aurascholar.merge-primary",
          duplicateId: "smoke-work-merge-duplicate",
          duplicateTitle: "Smoke Merge Duplicate Paper",
          duplicateDoi: "10.4242/aurascholar.merge-duplicate"
        };
        const MERGE_FAILURE_SMOKE = {
          error: "Smoke merge rollback failure",
          primaryId: "smoke-work-merge-failure-primary",
          primaryTitle: "Atomic Merge Failure Primary",
          primaryDoi: "10.4242/aurascholar.merge-failure-primary",
          duplicateId: "smoke-work-merge-failure-duplicate",
          duplicateTitle: "Atomic Merge Failure Duplicate",
          duplicateDoi: "10.4242/aurascholar.merge-failure-duplicate",
          attachmentId: "smoke-attachment-merge-failure",
          attachmentSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          query: "Atomic Merge Failure"
        };
        const MISSING_PDF = {
          author: "Grace Hopper",
          doi: "10.4242/aurascholar.missing-pdf",
          title: "Reader Recovery Without Full Text",
          venue: "Journal of Missing Full Text",
          workId: "smoke-work-missing-pdf",
          authorId: "smoke-author-grace"
        };
        const LIBRARY_UPLOAD_PDF = {
          author: "Mary Jackson",
          doi: "10.4242/aurascholar.library-upload-pdf",
          title: "Library Detail PDF Upload Feedback",
          venue: "Journal of Attachment UX",
          workId: "smoke-work-library-upload-pdf",
          authorId: "smoke-author-mary"
        };
        const BROKEN_BLOB = {
          attachmentId: "smoke-attachment-broken-blob",
          author: "Katherine Johnson",
          doi: "10.4242/aurascholar.broken-blob",
          sha: "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
          title: "Reader Recovery From Broken Local Blob",
          venue: "Journal of Local Resilience",
          workId: "smoke-work-broken-blob",
          authorId: "smoke-author-katherine"
        };
        const CORRUPT_PDF = {
          attachmentId: "smoke-attachment-corrupt-pdf",
          author: "Margaret Hamilton",
          doi: "10.4242/aurascholar.corrupt-pdf",
          title: "Reader Recovery From Corrupt PDF",
          venue: "Journal of Parse Resilience",
          workId: "smoke-work-corrupt-pdf",
          authorId: "smoke-author-margaret"
        };
        const READER_ARCHIVED_SMOKE = {
          annotationId: "smoke-annotation-reader-archived",
          attachmentId: "smoke-attachment-reader-archived",
          author: "Annie Easley",
          doi: "10.4242/aurascholar.reader-archived",
          title: "Archived Reader Link Should Restore First",
          venue: "Journal of Trustworthy Reader States",
          workId: "smoke-work-reader-archived",
          authorId: "smoke-author-annie"
        };
        const TRASH_ACTION_SMOKE = {
          author: "Barbara Liskov",
          doi: "10.4242/aurascholar.trash-action",
          title: "Recoverable Library Asset Actions",
          venue: "Journal of Safe Library Operations",
          workId: "smoke-work-trash-action",
          authorId: "smoke-author-barbara"
        };
        const TRASH_FAILURE_SMOKE = {
          author: "Evelyn Boyd Granville",
          doi: "10.4242/aurascholar.trash-failure",
          title: "Recoverable Trash Failure Feedback",
          venue: "Journal of Durable Library UX",
          workId: "smoke-work-trash-failure",
          authorId: "smoke-author-evelyn"
        };
        const TRASH_FAILURE_ERROR_SMOKE = {
          error: "Smoke library trash failure"
        };
        const BULK_TRASH_FAILURE_SMOKE = {
          error: "Smoke library bulk trash rollback failure",
          query: "Atomic Bulk Trash Failure",
          works: [
            {
              author: "Maryam Mirzakhani",
              doi: "10.4242/aurascholar.bulk-trash-failure-a",
              title: "Atomic Bulk Trash Failure Alpha",
              venue: "Journal of Atomic Library UX",
              workId: "smoke-work-bulk-trash-failure-a",
              authorId: "smoke-author-maryam"
            },
            {
              author: "Sofya Kovalevskaya",
              doi: "10.4242/aurascholar.bulk-trash-failure-b",
              title: "Atomic Bulk Trash Failure Beta",
              venue: "Journal of Atomic Library UX",
              workId: "smoke-work-bulk-trash-failure-b",
              authorId: "smoke-author-sofya"
            }
          ]
        };
        const TRASH_UNDO_SMOKE = {
          author: "Frances Allen",
          doi: "10.4242/aurascholar.trash-undo",
          title: "Instant Undo For Accidental Library Trash",
          venue: "Journal of Reversible UX",
          workId: "smoke-work-trash-undo",
          authorId: "smoke-author-frances"
        };
        const TRASH_UNDO_RESTORE_FAILURE_SMOKE = {
          error: "Smoke library trash undo restore failure"
        };
        const TRASH_RESTORE_FAILURE_SMOKE = {
          error: "Smoke library trash restore rollback failure",
          query: "Atomic Trash Restore Failure",
          works: [
            {
              author: "Joan Clarke",
              doi: "10.4242/aurascholar.trash-restore-failure-a",
              title: "Atomic Trash Restore Failure Alpha",
              venue: "Journal of Recoverable Library UX",
              workId: "smoke-work-trash-restore-failure-a",
              authorId: "smoke-author-joan"
            },
            {
              author: "Hedy Lamarr",
              doi: "10.4242/aurascholar.trash-restore-failure-b",
              title: "Atomic Trash Restore Failure Beta",
              venue: "Journal of Recoverable Library UX",
              workId: "smoke-work-trash-restore-failure-b",
              authorId: "smoke-author-hedy"
            }
          ]
        };
        const TRASH_PURGE_SMOKE = {
          author: "Grace Hopper",
          doi: "10.4242/aurascholar.trash-purge",
          title: "Typed Confirmation For Permanent Delete",
          venue: "Journal of Irreversible UX",
          workId: "smoke-work-trash-purge",
          authorId: "smoke-author-grace"
        };
        const TRASH_PURGE_FAILURE_SMOKE = {
          error: "Smoke library trash purge rollback failure",
          query: "Atomic Trash Purge Failure",
          works: [
            {
              author: "Radia Perlman",
              doi: "10.4242/aurascholar.trash-purge-failure-a",
              title: "Atomic Trash Purge Failure Alpha",
              venue: "Journal of Reversible Permanence",
              workId: "smoke-work-trash-purge-failure-a",
              authorId: "smoke-author-radia"
            },
            {
              author: "Karen Sparck Jones",
              doi: "10.4242/aurascholar.trash-purge-failure-b",
              title: "Atomic Trash Purge Failure Beta",
              venue: "Journal of Reversible Permanence",
              workId: "smoke-work-trash-purge-failure-b",
              authorId: "smoke-author-karen"
            }
          ]
        };
        const GRAPH_SMOKE = {
          centerDoi: "10.4242/aurascholar.graph-smoke",
          centerTitle: "Smoke Graph Center Paper",
          referenceDoi: " ",
          referenceTitle: "Smoke Graph Reference Node",
          successDoi: "10.4242/aurascholar.graph-import-success",
          successTitle: "Smoke Graph Import Success Node",
          raceOldDoi: "10.4242/aurascholar.graph-race-old",
          raceOldTitle: "Smoke Graph Race Stale Center",
          raceNewDoi: "10.4242/aurascholar.graph-race-new",
          raceNewTitle: "Smoke Graph Race Current Center",
          deepLinkDoi: "10.4242/aurascholar.graph-deeplink",
          deepLinkTitle: "Smoke Graph Deep Link Current Center",
          retryDoi: "10.4242/aurascholar.graph-retry",
          retryTitle: "Smoke Graph Retry Recovered Center",
        };
        const SNIPPET_SMOKE = {
          id: "smoke-snippet-keyboard",
          quote: "Smoke snippet quote for keyboard editing",
          noteDraft: "Smoke snippet note saved by keyboard shortcut"
        };
        const SNIPPET_DELETE_FAILURE_SMOKE = {
          error: "Smoke snippets delete failure"
        };
        const SNIPPET_RESTORE_FAILURE_SMOKE = {
          error: "Smoke snippets restore failure"
        };
        const SAVED_SEARCH_SMOKE = {
          id: "smoke-saved-search-duplicate",
          query: "Composition Discovery Search"
        };
        const SAVED_SEARCH_MANUAL_SMOKE = {
          id: "smoke-saved-search-manual-check",
          query: "Smoke Manual Saved Search Check"
        };
        const SAVED_SEARCH_SAVE_FAILURE_SMOKE = {
          query: "Smoke Saved Search Save Failure",
          error: "Smoke saved search save failure"
        };
        const SAVED_SEARCH_DELETE_FAILURE_SMOKE = {
          error: "Smoke saved search delete failure"
        };
        const SAVED_SEARCH_RESTORE_FAILURE_SMOKE = {
          error: "Smoke saved search restore failure"
        };
        const SAVED_SEARCH_HOME_OPEN_SMOKE = {
          id: "smoke-saved-search-home-open",
          query: "Smoke Home Saved Search Open"
        };
        const SAVED_SEARCH_ERROR_SMOKE = {
          id: "smoke-saved-search-last-error",
          query: "Smoke Saved Search Last Error",
          error: "Smoke saved search network failure"
        };
        const DISCOVERY_TRUST_SMOKE = {
          query: "Smoke Discovery Trust Signals",
          title: "Trustworthy Discovery Result With Open Full Text",
          doi: "10.4242/aurascholar.discovery-trust",
          abstract:
            "A smoke paper for checking provenance, confidence, identifiers, and open full text cues.",
          year: 2026,
          venueName: "Journal of Discovery UX",
          oaPdfUrl: "https://example.test/discovery-trust.pdf",
          citedByCount: 42,
          importResult: {
            delayMs: 80,
            doi: "10.4242/aurascholar.discovery-trust",
            pdfFetched: false,
            workId: "smoke-work-discovery-import"
          }
        };
        const DISCOVERY_LOAD_MORE_SMOKE = {
          query: "Smoke Discovery Load More Retry",
          firstDoi: "10.4242/aurascholar.discovery-load-more-first",
          firstTitle: "Smoke Discovery Load More First Page",
          recoveredDoi: "10.4242/aurascholar.discovery-load-more-recovered",
          recoveredTitle: "Smoke Discovery Load More Retry Recovered",
          error: "Smoke discovery load more transient failure"
        };
        const DISCOVERY_SEARCH_RETRY_SMOKE = {
          query: "Smoke Discovery Search Retry",
          doi: "10.4242/aurascholar.discovery-search-retry",
          title: "Smoke Discovery Search Retry Recovered",
          error: "Smoke discovery search transient failure"
        };
        const SENTINEL_DUPLICATE_SMOKE = {
          id: "smoke-sentinel-duplicate-doi",
          doi: "10.4242/aurascholar.sentinel-duplicate",
          title: "Smoke Duplicate Sentinel DOI"
        };
        const SENTINEL_RESTORE_SMOKE = {
          id: "smoke-sentinel-restore-doi",
          doi: "10.4242/aurascholar.sentinel-restore",
          title: "Smoke Restorable Sentinel DOI"
        };
        const SENTINEL_ERROR_SMOKE = {
          id: "smoke-sentinel-last-error",
          doi: "10.4242/aurascholar.sentinel-error",
          title: "Smoke Sentinel Last Error",
          error: "Smoke sentinel network failure"
        };
        const SENTINEL_MANUAL_FAILURE_SMOKE = {
          id: "smoke-sentinel-manual-failure",
          doi: "10.4242/aurascholar.sentinel-manual-failure",
          title: "Smoke Sentinel Manual Failure",
          errorFragment: "JSON"
        };
        const SENTINEL_DELETE_UNDO_SMOKE = {
          id: "smoke-sentinel-delete-undo",
          doi: "10.4242/aurascholar.sentinel-delete-undo",
          title: "Smoke Sentinel Delete Undo"
        };
        const SENTINEL_DELETE_FAILURE_SMOKE = {
          error: "Smoke sentinel delete failure"
        };
        const SENTINEL_RESTORE_FAILURE_SMOKE = {
          error: "Smoke sentinel restore failure"
        };
        const DISCOVERY_SITE_SMOKE = {
          id: "custom:smoke-duplicate-site",
          name: "Smoke Duplicate Site",
          homeUrl: "https://smoke-site.example/",
          searchUrl: "https://smoke-site.example/search?q="
        };
        const DISCOVERY_CREDENTIAL_SITE_SMOKE = {
          name: "Smoke Credential Site",
          homeUrl: "https://smoke-user:smoke-pass@credential-smoke-site.example/",
          searchUrl: "https://credential-smoke-site.example/search?q="
        };
        const REMOVABLE_DISCOVERY_SITE_SMOKE = {
          id: "custom:smoke-removable-site",
          name: "Smoke Removable Site",
          homeUrl: "https://removable-smoke-site.example/",
          searchUrl: "https://removable-smoke-site.example/search?q="
        };
        const DISCOVERY_SITE_REMOVE_FAILURE_SMOKE = {
          error: "Smoke discovery site remove failure"
        };
        const DISCOVERY_SITE_RESTORE_FAILURE_SMOKE = {
          error: "Smoke discovery site restore failure"
        };
        const HIDDEN_DISCOVERY_SITE_SMOKE = {
          id: "custom:smoke-hidden-duplicate-site",
          name: "Smoke Hidden Duplicate Site",
          homeUrl: "https://hidden-smoke-site.example/",
          searchUrl: "https://hidden-smoke-site.example/search?q="
        };
        const MANUAL_HIDDEN_DISCOVERY_SITE_SMOKE = {
          id: "custom:smoke-manual-hidden-site",
          name: "Smoke Manual Hidden Site",
          homeUrl: "https://manual-hidden-smoke-site.example/",
          searchUrl: "https://manual-hidden-smoke-site.example/search?q="
        };
        const DISCOVERY_PROXY_SITE_SMOKE = {
          id: "builtin:google-scholar",
          name: "Google Scholar"
        };
        const DISCOVERY_PROXY_CONFIG_SMOKE = "http://127.0.0.1:7890/";
        const DISCOVERY_PROXY_CREDENTIAL_SMOKE = "http://smoke-user:smoke-pass@127.0.0.1:7890/";
        const DISCOVERY_EZPROXY_CONFIG_SMOKE =
          "https://login.ezproxy.example.edu/login?url=";
        const DISCOVERY_EZPROXY_CREDENTIAL_SMOKE =
          "https://smoke-user:smoke-pass@login.ezproxy.example.edu/login?url=";
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
`;
