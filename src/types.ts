export type Role =
  "administrador" | "recepcion" | "pesaje" | "packing" | "gestor" | "auditor";
export interface Base {
  id: string;
  organization_id: string;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  status: string;
}
export interface Producer extends Base {
  name: string;
  document: string;
  phone: string;
  community: string;
  address: string;
  notes: string;
}
export interface Farm extends Base {
  producer_id: string;
  name: string;
  location: string;
}
export interface Plot extends Base {
  farm_id: string;
  name: string;
  location: string;
  area_ha: number | null;
  crop: string;
  variety: string;
  planting_date: string | null;
  harvest_date: string | null;
  notes: string;
}
export interface FieldLot extends Base {
  plot_id: string | null;
  producer_id?: string | null;
  code: string;
  crop: string;
  variety: string;
  harvest_date: string | null;
  notes: string;
}
export interface Reception extends Base {
  lot_id: string;
  date: string;
  responsible: string;
  notes: string;
}
export interface Weight extends Base {
  reception_id: string;
  sequence: number;
  kg: number;
  operator: string;
  notes: string;
  correction_reason: string;
}
export interface Classification extends Base {
  region?: string | null;
  pest_observation?: string | null;
  symptoms?: string | null;
  reception_id: string;
  approved_kg: number;
  rejected_kg: number;
  approved_count: number | null;
  rejected_count: number | null;
  reason: string;
  size: string;
  quality: number | null;
  notes: string;
}
export interface Pallet extends Base {
  code: string;
  token: string;
  destination: string;
  assembled_at: string;
  weighed_date?: string | null;
  responsible: string;
  gross_kg: number | null;
  net_kg: number;
  fruit_count: number | null;
  notes: string;
}
export interface PalletItem extends Base {
  pallet_id: string;
  reception_id: string;
  kg: number;
}
export interface Shipment extends Base {
  destination: string;
  country: string;
  customer: string;
  carrier: string;
  driver: string;
  plate: string;
  departure: string;
  responsible: string;
  notes: string;
}
export interface ShipmentPallet extends Base {
  shipment_id: string;
  pallet_id: string;
}
export interface Attachment extends Base {
  entity_type: "receptions" | "pallets" | "shipments";
  entity_id: string;
  name: string;
  mime: string;
  size: number;
  storage_path: string;
}
export interface AuditLog extends Base {
  entity_type: string;
  entity_id: string;
  action: string;
  actor: string;
  before: unknown;
  after: unknown;
  reason: string;
}
export interface Profile extends Base {
  user_id: string;
  name: string;
  role: Role;
}
export interface Data {
  producers: Producer[];
  farms: Farm[];
  plots: Plot[];
  field_lots: FieldLot[];
  receptions: Reception[];
  reception_weights: Weight[];
  classifications: Classification[];
  pallets: Pallet[];
  pallet_items: PalletItem[];
  shipments: Shipment[];
  shipment_pallets: ShipmentPallet[];
  attachments: Attachment[];
  audit_logs: AuditLog[];
}
export type Table = keyof Data;
export interface Workspace {
  needsRefresh?: boolean;
  data: Data;
  revision: number;
  pending: boolean;
  localOnly: boolean;
  organizationId: string;
  profile: Profile | null;
}

export interface PalletTrace {
  weighed_date?: string | null;
  code: string;
  product: string;
  net_kg: number;
  destination: string;
  status: string;
  origins: {
    lot_code: string;
    producer: string;
    parcel: string | null;
    locality: string;
    reception_date: string;
    allocated_kg: number;
  }[];
}
