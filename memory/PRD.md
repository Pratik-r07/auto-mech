# Auto-Mech Spares & Services – Invoice / Quotation / Challan App

## Problem statement (latest turn)
Redesign the bill and quotation to match the attached AUTO-MECH physical bill format:
- Replace "Reference" everywhere with "PO No."
- Add an auto-generating Delivery Challan feature (item + qty only, auto Challan No., first challan number typed manually)
- Add "Print with letterhead / without letterhead" toggle on the view/print screen for both bills and challans

## Architecture
- Backend: FastAPI + MongoDB (motor). JWT auth via cookies/Bearer. Single `documents` collection with `doc_type ∈ {quotation, bill, challan}`.
- Frontend: React (CRA + CRACO), Tailwind + Shadcn UI, react-router, sonner toasts, phosphor icons.

## Users
- Single owner-operator (`admin@example.com` / `admin123`).

## What's implemented (2026-02-04)
- Full bill / quotation / delivery-challan CRUD with per-year, per-type counters (`INV/2026/0001`, `QT/2026/0001`, plain numeric for challans).
- Challan supports manual starting number — first challan submits `number: "30"` (or any integer) and the counter is anchored so the next auto-picks `31`.
- Bill preview redesigned to mirror the physical AUTO-MECH invoice: red letterhead, INVOICE title bar, M/s. + Party GST buyer block, meta with INVOICE No./Date, Challan No./Date, P.O. No./Date, table with Sr No / DESCRIPTION / HSN / QTY / Unit Rate Per Rs / Amount (with Paise column), GSTIN, Total-in-Words, Bank block, Terms, Grand Amount and Authorised Signatory.
- Discount % supported (shown as "Less: Discount x%" row in preview).
- "Print with letterhead" toggle on DocumentView: hides only the top letterhead block so the doc fits on pre-printed letterhead paper.
- `reference` field removed from the model — replaced by `po_number` + `po_date`; bills also carry linked `challan_number` + `challan_date`.
- Delivery Challan editor is a simplified variant of the document editor: only description/qty/unit per line, no tax/rate/terms sections.
- Dashboard shows Quotation / Bill / Challan counts; sidebar has a new "Delivery Challans" nav.

## Backlog / Next Actions
- P1: Convert an existing quotation directly into a Delivery Challan (button in list, mirrors current "convert to bill").
- P1: Prefill new bill's Challan No./Date from an existing challan lookup dropdown.
- P2: Search + filter by date range and PO No. across lists.
- P2: Company Settings – "Print without letterhead by default" preference so the checkbox remembers the user's choice.
- P2: Migration for any older document that still has the old `reference` field.
