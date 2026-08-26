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

  it("fails closed when selecting the file does not start an upload request", async () => {
    const page = buildPage({ events: [], uploadStarts: false });
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
    })).rejects.toThrow("did not start a document upload request");

    expect(page.reload).not.toHaveBeenCalled();
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
});

function buildPage({
  events,
  uploadStarts = true,
  uploadStatus = 200
}: {
  events: string[];
  uploadStarts?: boolean;
  uploadStatus?: number;
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
  const page = {
    goto: vi.fn(async () => undefined),
    locator: vi.fn((selector: string) => {
      if (selector === 'input[name="poNumber"]') return referenceLocator;
      if (selector === 'input[type="file"]#box-labels') return fileLocator;
      return emptyLocator;
    }),
    getByText: vi.fn(() => fileText),
    waitForResponse: vi.fn((predicate: (response: typeof uploadResponse) => boolean) => {
      events.push("listen-for-upload");
      expect(predicate(uploadResponse)).toBe(true);
      return uploadStarts
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
