interface ReaderSmokeWindow extends Window {
  __AURASCHOLAR_SMOKE_READER_FAIL_NEXT_OPEN__?: string;
  __AURASCHOLAR_SMOKE_READER_FAIL_NEXT_COMMENT_SAVE__?: string;
  __AURASCHOLAR_SMOKE_READER_FAIL_NEXT_ANNOTATION_CREATE__?: string;
  __AURASCHOLAR_SMOKE_READER_FAIL_NEXT_ANNOTATION_DELETE__?: string;
  __AURASCHOLAR_SMOKE_READER_FAIL_NEXT_ANNOTATION_RESTORE__?: string;
  __AURASCHOLAR_SMOKE_READER_FAIL_NEXT_SNIPPET_SAVE__?: string;
}

type ReaderSmokeFailureKey =
  | "__AURASCHOLAR_SMOKE_READER_FAIL_NEXT_OPEN__"
  | "__AURASCHOLAR_SMOKE_READER_FAIL_NEXT_COMMENT_SAVE__"
  | "__AURASCHOLAR_SMOKE_READER_FAIL_NEXT_ANNOTATION_CREATE__"
  | "__AURASCHOLAR_SMOKE_READER_FAIL_NEXT_ANNOTATION_DELETE__"
  | "__AURASCHOLAR_SMOKE_READER_FAIL_NEXT_ANNOTATION_RESTORE__"
  | "__AURASCHOLAR_SMOKE_READER_FAIL_NEXT_SNIPPET_SAVE__";

function consumeReaderSmokeFailure(key: ReaderSmokeFailureKey): Error | null {
  const smokeWindow = window as ReaderSmokeWindow;
  const message = smokeWindow[key];
  if (!message) return null;
  delete smokeWindow[key];
  return new Error(message);
}

export function consumeReaderSmokeOpenFailure(): Error | null {
  return consumeReaderSmokeFailure("__AURASCHOLAR_SMOKE_READER_FAIL_NEXT_OPEN__");
}

export function consumeReaderSmokeCommentSaveFailure(): Error | null {
  return consumeReaderSmokeFailure("__AURASCHOLAR_SMOKE_READER_FAIL_NEXT_COMMENT_SAVE__");
}

export function consumeReaderSmokeAnnotationCreateFailure(): Error | null {
  return consumeReaderSmokeFailure("__AURASCHOLAR_SMOKE_READER_FAIL_NEXT_ANNOTATION_CREATE__");
}

export function consumeReaderSmokeAnnotationDeleteFailure(): Error | null {
  return consumeReaderSmokeFailure("__AURASCHOLAR_SMOKE_READER_FAIL_NEXT_ANNOTATION_DELETE__");
}

export function consumeReaderSmokeAnnotationRestoreFailure(): Error | null {
  return consumeReaderSmokeFailure("__AURASCHOLAR_SMOKE_READER_FAIL_NEXT_ANNOTATION_RESTORE__");
}

export function consumeReaderSmokeSnippetSaveFailure(): Error | null {
  return consumeReaderSmokeFailure("__AURASCHOLAR_SMOKE_READER_FAIL_NEXT_SNIPPET_SAVE__");
}
