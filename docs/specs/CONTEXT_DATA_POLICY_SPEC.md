# Context Data Policy Spec

## Objective

Prevent the Context Engine and future RAG layers from storing, vectorizing or sending sensitive information without explicit controls.

Milestone 1.5C-A introduces deterministic local scanning and redaction before pgvector, real local embeddings or any external provider is allowed.

## Scope

- Manual/project/artifact text already supported by Context Engine.
- Regex-based sensitive-data detection.
- Deterministic redaction before chunk persistence.
- Metadata describing classification, redaction status and findings.
- Mock embedding generation over persisted chunks, which are redacted when sensitive data was detected.
- Preview endpoint for dashboard and harness use.

## Out of Scope

- Full DLP.
- ML or LLM classifiers.
- pgvector.
- Ollama or real local embedding models.
- OpenAI, Gemini, Claude or other external embedding providers.
- GraphRAG.
- Code Graph.
- Filesystem, web, GitHub, Gmail or calendar sources.
- Tenant-level retention, quota or deletion policy.

## Data Classifications

```text
public
internal
confidential
secret
restricted
```

Initial policy:

```text
public: allowed
internal: allowed locally
confidential: allowed locally with metadata
secret: requires redaction before embedding/search
restricted: blocked by default
```

Clean manual text is classified as `internal` by default because there is no user-supplied classification field yet.

## Sensitive Finding Types

Initial deterministic regex findings:

```text
email
phone
dni_nie
iban
credit_card_like
api_key_like
jwt_like
private_key_like
password_like
secret_token_like
url_with_token
```

Findings record only:

- `type`
- `start`
- `end`
- `replacement`
- `severity`

Findings must not include the matched secret value.

## Redaction Status

```text
not_scanned
clean
redacted
blocked
```

- `not_scanned`: legacy or pre-policy row.
- `clean`: scanned and no findings.
- `redacted`: findings existed and persisted chunk text was redacted.
- `blocked`: restricted input was blocked by policy.

## Redaction Replacements

```text
[REDACTED_EMAIL]
[REDACTED_PHONE]
[REDACTED_DNI_NIE]
[REDACTED_IBAN]
[REDACTED_SECRET]
[REDACTED_TOKEN]
[REDACTED_PRIVATE_KEY]
```

Redaction must be deterministic enough for unit tests and harness scenarios.

## Ingestion Rules

1. Manual/project/artifact source documents may be submitted.
2. Before saving a document, the API scans and redacts normalized content.
3. `restricted` content is blocked by default and returns a clear conflict response.
4. Document metadata stores classification, redaction status, findings and optional redacted content hash.
5. Duplicate policy remains based on the original normalized content hash.
6. If findings exist, chunking uses redacted content.
7. If no findings exist, chunking uses normalized original content.
8. Original full content is still not stored as a document body; chunks store redacted text when policy requires it.

## Embedding Rules

- Mock embeddings are generated from persisted chunks.
- If the document was redacted, persisted chunks already contain redacted content.
- `restricted` or `blocked` documents must not generate embeddings.
- External providers remain prohibited.

## Preview API

```text
POST /api/context/redact/preview
```

Request:

```json
{
  "content": "text"
}
```

Response:

```json
{
  "classification": "secret",
  "redactionStatus": "redacted",
  "findings": [],
  "redactedContent": "..."
}
```

Preview does not persist data.

## Acceptance Criteria

- Redaction contracts exist in shared Zod schemas.
- Document ingestion scans content before persistence.
- Sensitive chunks do not contain original detected values.
- `restricted` content is blocked.
- Mock embeddings use redacted persisted chunks.
- Preview endpoint returns deterministic findings and redacted content.
- Harness validates preview, redacted ingestion, embedding generation over redacted chunks and restricted blocking.
- No external calls, providers or real embedding models are introduced.

## Risks

- Regex redaction is not complete DLP.
- False negatives are expected.
- False positives are possible.
- Finding offsets are relative to normalized input.
- There is no tenant-level retention, quota or deletion policy yet.
- Original input exists transiently in request memory and logs must not record request bodies.
