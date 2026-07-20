import type { TeamshipStoredCredentials } from "@/server/integrations/teamship-settings";

export type TeamshipBrowserScope = {
  customerId: string;
  customerName: string;
  warehouseId: string;
  warehouseName: string;
};

export type TeamshipBrowserInventoryAllRow = {
  inventoryId: string | null;
  productId: string | null;
  productName: string | null;
  sku: string | null;
  available: number | null;
  reserved: number | null;
  onHand: number | null;
  backordered: number | null;
  status: string | null;
  customerName: string | null;
  warehouseName: string | null;
  quarantined: boolean | null;
};

export type TeamshipBrowserLpnRow = {
  inventoryId: string | null;
  productId: string | null;
  sku: string | null;
  lpn: string | null;
  quantity: number | null;
  location: string | null;
  status: string | null;
  serialNumber: string | null;
  customerName: string | null;
  warehouseName: string | null;
  quarantined: boolean | null;
};

export type TeamshipBrowserReceivingOrder = {
  orderId: string;
  teamshipId: string | null;
  status: string | null;
  customerName: string | null;
  warehouseName: string | null;
  createdAt: string | null;
  eta: string | null;
  carrier: string | null;
  bolNumber: string | null;
  palletCount: number | null;
  items: Array<{
    productId: string | null;
    sku: string | null;
    incoming: number | null;
    received: number | null;
    lpn: string | null;
    location: string | null;
    weight: number | null;
  }>;
};

export type TeamshipBrowserProductHistory = {
  productId: string;
  sku: string | null;
  productName: string | null;
  customerName: string | null;
  rows: Array<{
    historyId: string | null;
    date: string | null;
    event: string | null;
    adjustment: number | null;
    availableAfter: number | null;
    warehouseName: string | null;
    batch: string | null;
    serialNumber: string | null;
    status: string | null;
  }>;
};

type TeamshipBrowserRequest = {
  credentials: TeamshipStoredCredentials;
  scope: TeamshipBrowserScope;
};

export type TeamshipBrowserReadAdapter = {
  searchInventoryAll(input: TeamshipBrowserRequest & { sku: string }): Promise<TeamshipBrowserInventoryAllRow[]>;
  searchLpn(input: TeamshipBrowserRequest & { queryType: "SKU" | "LPN"; query: string }): Promise<TeamshipBrowserLpnRow[]>;
  getReceivingOrder(input: TeamshipBrowserRequest & { orderId: string }): Promise<TeamshipBrowserReceivingOrder[]>;
  getProductHistory(input: TeamshipBrowserRequest & { productId: string }): Promise<TeamshipBrowserProductHistory[]>;
};

export const TEAMSHIP_BROWSER_READ_ALLOWED_CONTROLS = [
  "All",
  "Ship by LPN",
  "Search"
] as const;

export const TEAMSHIP_BROWSER_BLOCKED_CONTROL_NAMES = [
  "Add Inventory",
  "Ship Inventory",
  "Ship LPN's",
  "Transfer Order",
  "Import Shipping Order",
  "Update Inventory Stock",
  "Blind Order",
  "Warehouse Receipt",
  "Receive this product",
  "Create LPNs",
  "Add Another Product",
  "Add Another Charge",
  "Save",
  "Delete Order",
  "Complete Receiving",
  "Edit",
  "Send",
  "Mark as quarantine",
  "Deactivate",
  "Print"
] as const;

export function assertTeamshipReadControlAllowed(name: string) {
  if (!TEAMSHIP_BROWSER_READ_ALLOWED_CONTROLS.includes(name as typeof TEAMSHIP_BROWSER_READ_ALLOWED_CONTROLS[number])) {
    throw new Error(`Teamship browser read control is not allowlisted: ${name}`);
  }
}
