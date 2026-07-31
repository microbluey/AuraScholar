import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ProjectTargetPicker, requestProjectTargetPickerCancel } from "./ProjectTargetPicker";

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void;
  const promise = new Promise<void>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

const handlers = {
  onCancel: vi.fn(),
  onConfirm: vi.fn(async () => undefined),
  onCreateProject: vi.fn(async (name: string) => ({ id: "new", name })),
};

describe("ProjectTargetPicker", () => {
  it("renders nothing while closed", () => {
    expect(
      renderToStaticMarkup(
        <ProjectTargetPicker
          {...handlers}
          defaultProjectId=""
          open={false}
          projects={[]}
          workCount={1}
        />,
      ),
    ).toBe("");
  });

  it("renders an accessible multi-project target dialog with its default selected", () => {
    const markup = renderToStaticMarkup(
      <ProjectTargetPicker
        {...handlers}
        defaultProjectId="project-b"
        open
        projects={[
          { id: "project-a", name: "Project A" },
          { description: "Methods", id: "project-b", name: "Project B" },
        ]}
        sourceLabel="Paper A"
        workCount={1}
      />,
    );

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('role="radiogroup"');
    expect(markup).toContain('data-project-id="project-b"');
    expect(markup).toContain('aria-checked="true"');
    expect(markup).toContain("最近使用");
    expect(markup).not.toContain(">默认<");
    expect(markup).toContain("「Paper A」");
    expect(markup).toContain("新建研究项目");
    expect(markup).toContain("Enter 确认");
  });

  it("starts with inline creation when there is no project", () => {
    const markup = renderToStaticMarkup(
      <ProjectTargetPicker {...handlers} defaultProjectId="" open projects={[]} workCount={4} />,
    );

    expect(markup).toContain("先创建一个研究项目");
    expect(markup).toContain('data-project-new-name="true"');
    expect(markup).toContain("创建并加入");
    expect(markup).toContain("4 篇文献");
  });

  it("refuses cancellation while a deferred durable write is busy", async () => {
    const write = deferred();
    const onCancel = vi.fn();
    let busy = false;
    const commit = async () => {
      busy = true;
      await write.promise;
      busy = false;
    };

    const pending = commit();
    expect(requestProjectTargetPickerCancel(busy, onCancel)).toBe(false);
    expect(onCancel).not.toHaveBeenCalled();

    write.resolve();
    await pending;
    expect(requestProjectTargetPickerCancel(busy, onCancel)).toBe(true);
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
