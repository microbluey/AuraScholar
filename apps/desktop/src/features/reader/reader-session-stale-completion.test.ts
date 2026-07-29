import { describe, expect, it } from "vitest";
import {
  applyReaderSessionCompletion,
  createReaderSessionCoordinator,
  type ReaderSessionLease,
} from "./reader-session-coordinator";

interface LoadedReaderDocument {
  attachmentId: string;
  title: string;
  workId: string;
}

interface VisibleAnnotation {
  id: string;
  workId: string;
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

function projectWhenCurrent<T>(
  lease: ReaderSessionLease,
  pending: Promise<T>,
  apply: (value: T) => void,
): Promise<boolean> {
  return pending.then((value) => {
    return applyReaderSessionCompletion(lease, () => apply(value));
  });
}

describe("reader stale completion isolation", () => {
  it("keeps document B visible when document A finishes loading after the switch", async () => {
    const coordinator = createReaderSessionCoordinator();
    const documentA = deferred<LoadedReaderDocument>();
    const documentB = deferred<LoadedReaderDocument>();
    let visibleDocument: LoadedReaderDocument | null = null;

    const leaseA = coordinator.begin({
      kind: "library",
      workId: "work-a",
      attachmentId: "attachment-a",
    });
    const pendingA = projectWhenCurrent(leaseA, documentA.promise, (loaded) => {
      visibleDocument = loaded;
    });

    const leaseB = coordinator.begin({
      kind: "library",
      workId: "work-b",
      attachmentId: "attachment-b",
    });
    const pendingB = projectWhenCurrent(leaseB, documentB.promise, (loaded) => {
      visibleDocument = loaded;
    });

    expect(leaseA.signal.aborted).toBe(true);
    expect(leaseA.isCurrent()).toBe(false);
    expect(leaseB.isCurrent()).toBe(true);

    documentB.resolve({
      attachmentId: "attachment-b",
      title: "Document B",
      workId: "work-b",
    });
    await expect(pendingB).resolves.toBe(true);

    documentA.resolve({
      attachmentId: "attachment-a",
      title: "Document A",
      workId: "work-a",
    });
    await expect(pendingA).resolves.toBe(false);

    expect(visibleDocument).toEqual({
      attachmentId: "attachment-b",
      title: "Document B",
      workId: "work-b",
    });
  });

  it("does not project a committed annotation write into document B after switching from A", async () => {
    const coordinator = createReaderSessionCoordinator();
    const committedWrite = deferred<VisibleAnnotation>();
    let writeCommitted = false;
    let visibleAnnotations: VisibleAnnotation[] = [];

    const leaseA = coordinator.begin({
      kind: "library",
      workId: "work-a",
      attachmentId: "attachment-a",
    });
    const pendingMutation = projectWhenCurrent(
      leaseA,
      committedWrite.promise.then((annotation) => {
        writeCommitted = true;
        return annotation;
      }),
      (annotation) => {
        visibleAnnotations = [...visibleAnnotations, annotation];
      },
    );

    coordinator.begin({
      kind: "library",
      workId: "work-b",
      attachmentId: "attachment-b",
    });
    const visibleWorkId = "work-b";
    visibleAnnotations = [{ id: "annotation-b", workId: "work-b" }];

    committedWrite.resolve({ id: "annotation-a-committed", workId: "work-a" });
    await expect(pendingMutation).resolves.toBe(false);

    expect(writeCommitted).toBe(true);
    expect(visibleWorkId).toBe("work-b");
    expect(visibleAnnotations).toEqual([{ id: "annotation-b", workId: "work-b" }]);
  });
});
