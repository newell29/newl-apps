import { describe, expect, it, vi } from "vitest";

const playwrightMocks = vi.hoisted(() => ({
  launch: vi.fn()
}));

vi.mock("playwright-core", () => ({
  chromium: { launch: playwrightMocks.launch }
}));

import { executeTmgTeamshipDocumentUpload } from "@/modules/shipment-documents/tmg-teamship-document-upload";

describe("TMG Teamship document upload", () => {
  it("waits for Teamship's upload response and network idle before verifying after reload", async () => {
    const events: string[] = [];
    const page = buildPage({ events });
    const close = vi.fn(async () => undefined);
    playwrightMocks.launch.mockResolvedValue({
      newPage: vi.fn(async () => page),
      close
    });

    const result = await executeTmgTeamshipDocumentUpload({
      credentials: credentials(),
      job: job(),
      options: {
        allowLiveUpload: true,
        browserExecutablePath: "/usr/bin/google-chrome",
        headed: false
      }
    });

    expect(result).toMatchObject({
      status: "UPLOADED",
      customerReference: "US19999",
      fileName: "TMG US19999.pdf"
    });
    expect(events).toEqual([
      "listen-for-upload",
      "select-file",
      "filename-visible",
      "read-upload-status",
      "network-idle",
      "settle-upload",
      "reload"
    ]);
    expect(close).toHaveBeenCalledOnce();
  });

  it("submits the staged document when file selection does not auto-upload", async () => {
    const events: string[] = [];
    const page = buildPage({ events, automaticUploadStarts: false });
    playwrightMocks.launch.mockResolvedValue({
      newPage: vi.fn(async () => page),
      close: vi.fn(async () => undefined)
    });

    await expect(executeTmgTeamshipDocumentUpload({
      credentials: credentials(),
      job: job(),
      options: {
        allowLiveUpload: true,
        browserExecutablePath: "/usr/bin/google-chrome",
        headed: false
      }
    })).resolves.toMatchObject({ status: "UPLOADED" });

    expect(events).toEqual([
      "listen-for-upload",
      "select-file",
      "filename-visible",
      "listen-for-upload",
      "scroll-submit",
      "click-submit",
      "read-upload-status",
      "network-idle",
      "settle-upload",
      "reload"
    ]);
  });

  it("fails closed when Teamship rejects the upload request", async () => {
    const page = buildPage({ events: [], uploadStatus: 500 });
    playwrightMocks.launch.mockResolvedValue({
      newPage: vi.fn(async () => page),
      close: vi.fn(async () => undefined)
    });

    await expect(executeTmgTeamshipDocumentUpload({
      credentials: credentials(),
      job: job(),
      options: {
        allowLiveUpload: true,
        browserExecutablePath: "/usr/bin/google-chrome",
        headed: false
      }
    })).rejects.toThrow("rejected the document upload with status 500");

    expect(page.reload).not.toHaveBeenCalled();
  });

  it("fails closed without clicking when the safe submit control is ambiguous", async () => {
    const events: string[] = [];
    const page = buildPage({ events, automaticUploadStarts: false, submitButtonCount: 2 });
    playwrightMocks.launch.mockResolvedValue({
      newPage: vi.fn(async () => page),
      close: vi.fn(async () => undefined)
    });

    await expect(executeTmgTeamshipDocumentUpload({
      credentials: credentials(),
      job: job(),
      options: {
        allowLiveUpload: true,
        browserExecutablePath: "/usr/bin/google-chrome",
        headed: false
      }
    })).rejects.toThrow("did not expose exactly one safe");

    expect(events).not.toContain("click-submit");
    expect(page.reload).not.toHaveBeenCalled();
  });

  it("fails closed when submitting the staged document starts no upload request", async () => {
    const events: string[] = [];
    const page = buildPage({ events, automaticUploadStarts: false, submittedUploadStarts: false });
    playwrightMocks.launch.mockResolvedValue({
      newPage: vi.fn(async () => page),
      close: vi.fn(async () => undefined)
    });

    await expect(executeTmgTeamshipDocumentUpload({
      credentials: credentials(),
      job: job(),
      options: {
        allowLiveUpload: true,
        browserExecutablePath: "/usr/bin/google-chrome",
        headed: false
      }
    })).rejects.toThrow("after the staged document was submitted");

    expect(events).toContain("click-submit");
    expect(page.reload).not.toHaveBeenCalled();
  });
});

function buildPage({
  events,
  automaticUploadStarts = true,
  submittedUploadStarts = true,
  uploadStatus = 200,
  submitButtonCount = 1
}: {
  events: string[];
  automaticUploadStarts?: boolean;
  submittedUploadStarts?: boolean;
  uploadStatus?: number;
  submitButtonCount?: number;
}) {
  let reloaded = false;
  const emptyLocator = {
    first() { return this; },
    count: vi.fn(async () => 0)
  };
  const referenceLocator = {
    first() { return this; },
    count: vi.fn(async () => 1),
    getAttribute: vi.fn(async (name: string) => name === "value"
      ? "US19999; 5 sides 5 layers shrink wrap"
      : null)
  };
  const fileLocator = {
    count: vi.fn(async () => 1),
    setInputFiles: vi.fn(async () => {
      events.push("select-file");
    })
  };
  const fileText = {
    isVisible: vi.fn(async () => reloaded),
    waitFor: vi.fn(async () => {
      events.push("filename-visible");
    })
  };
  const uploadRequest = {
    method: () => "POST",
    headers: () => ({ "content-type": "multipart/form-data; boundary=synthetic" })
  };
  const uploadResponse = {
    request: () => uploadRequest,
    url: () => "https://app.teamshipos.com/ship-inventories/documents/upload",
    status: () => {
      events.push("read-upload-status");
      return uploadStatus;
    }
  };
  const submitButton = {
    isVisible: vi.fn(async () => true),
    isEnabled: vi.fn(async () => true),
    scrollIntoViewIfNeeded: vi.fn(async () => { events.push("scroll-submit"); }),
    click: vi.fn(async () => { events.push("click-submit"); })
  };
  const submitButtons = {
    count: vi.fn(async () => submitButtonCount),
    nth: vi.fn(() => submitButton)
  };
  let responseListenerCount = 0;
  const page = {
    goto: vi.fn(async () => undefined),
    locator: vi.fn((selector: string) => {
      if (selector === 'input[name="poNumber"]') return referenceLocator;
      if (selector === 'input[type="file"]#box-labels') return fileLocator;
      return emptyLocator;
    }),
    getByText: vi.fn(() => fileText),
    getByRole: vi.fn(() => submitButtons),
    waitForResponse: vi.fn((predicate: (response: typeof uploadResponse) => boolean) => {
      events.push("listen-for-upload");
      expect(predicate(uploadResponse)).toBe(true);
      responseListenerCount += 1;
      const starts = responseListenerCount === 1 ? automaticUploadStarts : submittedUploadStarts;
      return starts
        ? Promise.resolve(uploadResponse)
        : new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 10));
    }),
    waitForLoadState: vi.fn(async (state: string) => {
      if (state === "networkidle") events.push("network-idle");
    }),
    waitForTimeout: vi.fn(async (timeout: number) => {
      if (timeout === 1_000) events.push("settle-upload");
    }),
    reload: vi.fn(async () => {
      events.push("reload");
      reloaded = true;
    })
  };
  return page;
}

function credentials() {
  return {
    email: "user@example.com",
    password: "test-password",
    apiBaseUrl: "https://app.teamshipos.com/api"
  };
}

function job() {
  return {
    id: "order-example",
    status: "APPROVED" as const,
    customerReference: "US19999",
    teamshipOrderId: "812345",
    fileName: "TMG US19999.pdf",
    fileBytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
    fileHash: "a".repeat(64),
    requestHash: "b".repeat(64),
    approvedRequestHash: "b".repeat(64)
  };
}
