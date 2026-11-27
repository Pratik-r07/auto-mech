from dotenv import load_dotenv
from pathlib import Path
import os

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

from fastapi import FastAPI, APIRouter, Request, HTTPException, Depends, UploadFile, File, Form
from fastapi.responses import StreamingResponse
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorGridFSBucket
from pydantic import BaseModel, Field, EmailStr, BeforeValidator, ConfigDict
from typing import List, Optional, Annotated, Literal
from datetime import datetime, timezone, timedelta
from bson import ObjectId
import bcrypt
import jwt
import logging
import asyncio
import imaplib
import re
import email as email_lib
from email import policy as email_policy
from email.utils import parseaddr, parsedate_to_datetime
from html import unescape
from urllib.parse import quote

# ---------------------------------------------------------------------------
# DB
# ---------------------------------------------------------------------------
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Client files (PDFs, photos, etc.) are stored inside MongoDB using GridFS,
# so no extra storage service is needed. Each file carries its client_id.
fs_bucket = AsyncIOMotorGridFSBucket(db, bucket_name="client_files")
FILES_COLL = db["client_files.files"]
MAX_FILE_BYTES = 15 * 1024 * 1024  # 15 MB per file
# Sub-folders inside every client folder. Files saved before sub-folders existed
# have no category and show up under "other".
FILE_CATEGORIES = ("bill", "challan", "quotation", "purchase_order")

JWT_ALGORITHM = "HS256"


def get_jwt_secret() -> str:
    return os.environ["JWT_SECRET"]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
PyObjectId = Annotated[str, BeforeValidator(str)]


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def oid(value: str) -> ObjectId:
    try:
        return ObjectId(value)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid id")


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


def create_access_token(user_id: str, email: str) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "exp": now_utc() + timedelta(days=7),
        "type": "access",
    }
    return jwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
class LoginInput(BaseModel):
    email: EmailStr
    password: str


class LineItem(BaseModel):
    # "item" = a normal priced line. "header" = a section heading row (only its description
    # is used; it has no quantity, rate or amount and is not numbered).
    kind: Literal["item", "header"] = "item"
    description: str = ""
    hsn: str = ""
    qty: float = 1
    unit: str = "nos"
    rate: float = 0


class ItemCatalogOut(BaseModel):
    description: str = ""
    hsn: str = ""
    unit: str = "nos"
    rate: float = 0


class DocumentBase(BaseModel):
    model_config = ConfigDict(extra="ignore")
    doc_type: Literal["quotation", "bill", "challan"] = "quotation"
    number: str = ""
    date: str = ""
    po_number: str = ""
    po_date: str = ""
    challan_number: str = ""
    challan_date: str = ""
    invoice_number: str = ""
    invoice_date: str = ""
    subject: str = ""
    intro: str = ""
    closing: str = ""
    # customer
    customer_name: str = ""
    customer_address: str = ""
    customer_gstin: str = ""
    udyam_number: str = ""
    customer_attention: str = ""
    # items
    items: List[LineItem] = Field(default_factory=list)
    # tax
    gst_type: Literal["cgst_sgst", "igst", "none"] = "cgst_sgst"
    gst_rate: float = 18
    # discount (flat percentage on subtotal)
    discount_percent: float = 0
    # terms
    terms: dict = Field(default_factory=dict)
    notes: str = ""
    status: str = "draft"


class DocumentCreate(DocumentBase):
    pass


class DocumentOut(DocumentBase):
    id: str
    subtotal: float = 0
    cgst: float = 0
    sgst: float = 0
    igst: float = 0
    total_tax: float = 0
    grand_total: float = 0
    created_at: str = ""
    updated_at: str = ""


DEFAULT_TERMS = {
    "payment": "After delivery.",
    "taxes": "GST @ 18% as applicable.",
    "delivery": "Within two weeks.",
    "freight": "Extra to your account.",
    "guarantee": "To your satisfaction.",
}


class CompanyProfile(BaseModel):
    model_config = ConfigDict(extra="ignore")
    name: str = "Auto~Mech Spares&Service"
    tagline: str = "Specialist in : Supplying of Automatic Bottling Machineries Spares & Services"
    address: str = "Plot No. 128, C – 15/16, CHSS MAHADA Colony,\nS.V. Nagar, Near Vasnath Vihar,\nPokhran – II, THANE – 400 610. MAHARASTRA"
    phone: str = "09821108060"
    email: str = "sn_rajvir@yahoo.com / mech_auto02@yahoo.co.in"
    gstin: str = ""
    logo: str = ""
    bank_name: str = ""
    bank_account: str = ""
    bank_ifsc: str = ""
    bank_branch: str = ""
    signatory: str = "Sanjay Rajvir"
    default_terms: dict = Field(default_factory=lambda: dict(DEFAULT_TERMS))


class ClientModel(BaseModel):
    model_config = ConfigDict(extra="ignore")
    name: str
    address: str = ""
    gstin: str = ""
    attention: str = ""
    phone: str = ""
    email: str = ""


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------
app = FastAPI()
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Auth dependency
# ---------------------------------------------------------------------------
async def get_current_user(request: Request) -> dict:
    token = request.cookies.get("access_token")
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(token, get_jwt_secret(), algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "access":
            raise HTTPException(status_code=401, detail="Invalid token type")
        user = await db.users.find_one({"_id": ObjectId(payload["sub"])})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        user["id"] = str(user["_id"])
        user.pop("_id", None)
        user.pop("password_hash", None)
        return user
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


# ---------------------------------------------------------------------------
# Calculation
# ---------------------------------------------------------------------------
def compute_totals(doc: dict) -> dict:
    gross = 0.0
    for it in doc.get("items", []):
        if it.get("kind") == "header":
            continue
        gross += float(it.get("qty", 0) or 0) * float(it.get("rate", 0) or 0)
    gross = round(gross, 2)
    disc_pct = float(doc.get("discount_percent", 0) or 0)
    discount = round(gross * disc_pct / 100, 2)
    subtotal = round(gross - discount, 2)
    rate = float(doc.get("gst_rate", 0) or 0)
    gst_type = doc.get("gst_type", "cgst_sgst")
    cgst = sgst = igst = 0.0
    if gst_type == "cgst_sgst":
        cgst = round(subtotal * (rate / 2) / 100, 2)
        sgst = round(subtotal * (rate / 2) / 100, 2)
    elif gst_type == "igst":
        igst = round(subtotal * rate / 100, 2)
    total_tax = round(cgst + sgst + igst, 2)
    grand_total = round(subtotal + total_tax, 2)
    return {
        "gross": gross,
        "discount": discount,
        "subtotal": subtotal,
        "cgst": cgst,
        "sgst": sgst,
        "igst": igst,
        "total_tax": total_tax,
        "grand_total": grand_total,
    }


def payment_summary(doc: dict, grand_total: float) -> dict:
    """Paid / balance / status for bills. Other document types have no payment info."""
    if doc.get("doc_type") != "bill":
        return {}
    paid = round(sum(float(p.get("amount", 0) or 0) for p in doc.get("payments", [])), 2)
    balance = round(max(grand_total - paid, 0), 2)
    if grand_total > 0 and balance <= 0.01:
        status = "paid"
    elif paid > 0:
        status = "partial"
    else:
        status = "unpaid"
    overdue = False
    due = doc.get("due_date") or ""
    if due and status != "paid":
        try:
            overdue = datetime.fromisoformat(due).date() < datetime.now().date()
        except ValueError:
            overdue = False
    return {
        "amount_paid": paid,
        "balance": balance,
        "payment_status": status,
        "overdue": overdue,
        "due_date": due,
        "payments": doc.get("payments", []),
    }


def serialize_doc(doc: dict) -> dict:
    doc = dict(doc)
    doc["id"] = str(doc.pop("_id"))
    totals = compute_totals(doc)
    doc.update(totals)
    doc.update(payment_summary(doc, totals["grand_total"]))
    return doc


async def next_number(doc_type: str) -> str:
    prefix = {"quotation": "QT", "bill": "INV", "challan": "DC"}.get(doc_type, "DOC")
    year = datetime.now().year
    key = f"{doc_type}_{year}"
    counter = await db.counters.find_one_and_update(
        {"_id": key},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=True,
    )
    seq = counter["seq"]
    if doc_type == "challan":
        # Challans use a plain running number to match the physical challan book
        return str(seq)
    return f"{prefix}/{year}/{seq:04d}"


async def set_counter(doc_type: str, value: int) -> int:
    year = datetime.now().year
    key = f"{doc_type}_{year}"
    await db.counters.update_one(
        {"_id": key}, {"$set": {"seq": max(0, int(value))}}, upsert=True
    )
    return value


# ---------------------------------------------------------------------------
# Auth routes
# ---------------------------------------------------------------------------
@api_router.post("/auth/login")
async def login(payload: LoginInput):
    email = payload.email.lower()
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = create_access_token(str(user["_id"]), email)
    return {
        "token": token,
        "user": {"id": str(user["_id"]), "email": email, "name": user.get("name", "")},
    }


@api_router.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return user


# ---------------------------------------------------------------------------
# Company profile
# ---------------------------------------------------------------------------
@api_router.get("/company")
async def get_company(user: dict = Depends(get_current_user)):
    doc = await db.company.find_one({})
    if not doc:
        default = CompanyProfile().model_dump()
        await db.company.insert_one(dict(default))
        return default
    doc.pop("_id", None)
    return doc


@api_router.put("/company")
async def update_company(payload: CompanyProfile, user: dict = Depends(get_current_user)):
    data = payload.model_dump()
    await db.company.update_one({}, {"$set": data}, upsert=True)
    return data


# ---------------------------------------------------------------------------
# Clients
# ---------------------------------------------------------------------------
@api_router.get("/clients")
async def list_clients(user: dict = Depends(get_current_user)):
    out = []
    async for c in db.clients.find().sort("name", 1):
        c["id"] = str(c.pop("_id"))
        out.append(c)
    return out


@api_router.post("/clients")
async def create_client(payload: ClientModel, user: dict = Depends(get_current_user)):
    data = payload.model_dump()
    data["created_at"] = now_utc().isoformat()
    res = await db.clients.insert_one(data)
    data["id"] = str(res.inserted_id)
    data.pop("_id", None)
    return data


@api_router.put("/clients/{client_id}")
async def update_client(client_id: str, payload: ClientModel, user: dict = Depends(get_current_user)):
    res = await db.clients.update_one({"_id": oid(client_id)}, {"$set": payload.model_dump()})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Client not found")
    doc = await db.clients.find_one({"_id": oid(client_id)})
    doc["id"] = str(doc.pop("_id"))
    return doc


@api_router.delete("/clients/{client_id}")
async def delete_client(client_id: str, user: dict = Depends(get_current_user)):
    file_count = await FILES_COLL.count_documents({"metadata.client_id": client_id})
    if file_count:
        raise HTTPException(
            status_code=400,
            detail=f"This client's folder still has {file_count} file(s). Delete the files first.",
        )
    res = await db.clients.delete_one({"_id": oid(client_id)})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Client not found")
    return {"ok": True}


# ---------------------------------------------------------------------------
# Item catalog — remembers every item description + its last-used rate/unit,
# so it can be looked up and auto-filled next time the same item is typed.
# ---------------------------------------------------------------------------
async def remember_items(items: list):
    for it in items or []:
        if it.get("kind") == "header":
            continue  # section headings are not products
        desc = (it.get("description") or "").strip()
        if not desc:
            continue
        key = desc.lower()
        await db.item_catalog.update_one(
            {"key": key},
            {
                "$set": {
                    "key": key,
                    "description": desc,
                    "hsn": it.get("hsn") or "",
                    "unit": it.get("unit") or "nos",
                    "rate": float(it.get("rate") or 0),
                    "updated_at": now_utc().isoformat(),
                }
            },
            upsert=True,
        )


@api_router.get("/items")
async def search_items(q: Optional[str] = None, user: dict = Depends(get_current_user)):
    query = {}
    if q:
        query["key"] = {"$regex": q.strip().lower(), "$options": "i"}
    out = []
    cursor = db.item_catalog.find(query).sort("updated_at", -1).limit(200)
    async for it in cursor:
        out.append({
            "description": it.get("description", ""),
            "hsn": it.get("hsn", ""),
            "unit": it.get("unit", "nos"),
            "rate": it.get("rate", 0),
        })
    return out


# ---------------------------------------------------------------------------
# Documents (quotations + bills)
# ---------------------------------------------------------------------------
@api_router.get("/documents")
async def list_documents(doc_type: Optional[str] = None, user: dict = Depends(get_current_user)):
    query = {}
    if doc_type:
        query["doc_type"] = doc_type
    out = []
    async for d in db.documents.find(query).sort("created_at", -1):
        out.append(serialize_doc(d))
    return out


@api_router.get("/documents/stats")
async def stats(user: dict = Depends(get_current_user)):
    quotations = []
    bills = []
    challan_count = 0
    outstanding = received = 0.0
    unpaid_count = overdue_count = 0
    async for d in db.documents.find():
        t = compute_totals(d)
        if d.get("doc_type") == "quotation":
            quotations.append(t["grand_total"])
        elif d.get("doc_type") == "challan":
            challan_count += 1
        else:
            bills.append(t["grand_total"])
            ps = payment_summary(d, t["grand_total"])
            outstanding += ps["balance"]
            received += ps["amount_paid"]
            if ps["payment_status"] != "paid":
                unpaid_count += 1
            if ps["overdue"]:
                overdue_count += 1
    pending_orders = await db.orders.count_documents({"status": "pending"})
    open_orders = await db.orders.count_documents({"status": {"$in": ["pending", "in_progress"]}})
    return {
        "outstanding": round(outstanding, 2),
        "received": round(received, 2),
        "unpaid_count": unpaid_count,
        "overdue_count": overdue_count,
        "pending_orders": pending_orders,
        "open_orders": open_orders,
        "quotation_count": len(quotations),
        "bill_count": len(bills),
        "challan_count": challan_count,
        "quotation_value": round(sum(quotations), 2),
        "bill_value": round(sum(bills), 2),
    }


@api_router.get("/documents/{doc_id}")
async def get_document(doc_id: str, user: dict = Depends(get_current_user)):
    d = await db.documents.find_one({"_id": oid(doc_id)})
    if not d:
        raise HTTPException(status_code=404, detail="Document not found")
    return serialize_doc(d)


@api_router.post("/documents")
async def create_document(payload: DocumentCreate, user: dict = Depends(get_current_user)):
    data = payload.model_dump()
    if data.get("doc_type") == "challan" and data.get("number"):
        # Manual challan number: use as-is and bump counter to match so future auto-picks continue from here
        try:
            n = int(data["number"])
            await set_counter("challan", n)
        except (TypeError, ValueError):
            pass
    if not data.get("number"):
        data["number"] = await next_number(data["doc_type"])
    if not data.get("date"):
        data["date"] = datetime.now().strftime("%d/%m/%Y")
    data["created_at"] = now_utc().isoformat()
    data["updated_at"] = data["created_at"]
    res = await db.documents.insert_one(data)
    d = await db.documents.find_one({"_id": res.inserted_id})
    await remember_items(data.get("items"))
    return serialize_doc(d)


@api_router.get("/counters/{doc_type}")
async def get_counter(doc_type: str, user: dict = Depends(get_current_user)):
    year = datetime.now().year
    key = f"{doc_type}_{year}"
    c = await db.counters.find_one({"_id": key})
    return {"doc_type": doc_type, "year": year, "seq": (c or {}).get("seq", 0)}


@api_router.put("/documents/{doc_id}")
async def update_document(doc_id: str, payload: DocumentCreate, user: dict = Depends(get_current_user)):
    existing = await db.documents.find_one({"_id": oid(doc_id)})
    if not existing:
        raise HTTPException(status_code=404, detail="Document not found")
    data = payload.model_dump()
    # Preserve server-managed identity fields if client sent them empty
    if not data.get("number"):
        data["number"] = existing.get("number", "")
    if not data.get("date"):
        data["date"] = existing.get("date", "")
    data["updated_at"] = now_utc().isoformat()
    await db.documents.update_one({"_id": oid(doc_id)}, {"$set": data})
    d = await db.documents.find_one({"_id": oid(doc_id)})
    await remember_items(data.get("items"))
    return serialize_doc(d)


@api_router.post("/documents/{doc_id}/convert")
async def convert_to_bill(doc_id: str, user: dict = Depends(get_current_user)):
    d = await db.documents.find_one({"_id": oid(doc_id)})
    if not d:
        raise HTTPException(status_code=404, detail="Document not found")
    new = dict(d)
    new.pop("_id", None)
    new.pop("payments", None)
    new.pop("due_date", None)
    new["doc_type"] = "bill"
    new["number"] = await next_number("bill")
    new["date"] = datetime.now().strftime("%d/%m/%Y")
    new["status"] = "draft"
    new["created_at"] = now_utc().isoformat()
    new["updated_at"] = new["created_at"]
    res = await db.documents.insert_one(new)
    created = await db.documents.find_one({"_id": res.inserted_id})
    return serialize_doc(created)


@api_router.post("/documents/{doc_id}/to_challan")
async def convert_to_challan(doc_id: str, user: dict = Depends(get_current_user)):
    """Create a Delivery Challan from an existing bill (or quotation).

    The new challan copies customer + items (description, qty, unit) and links back to the
    source invoice via invoice_number / invoice_date fields.
    """
    d = await db.documents.find_one({"_id": oid(doc_id)})
    if not d:
        raise HTTPException(status_code=404, detail="Document not found")
    src_type = d.get("doc_type", "bill")
    challan = {
        "doc_type": "challan",
        "number": await next_number("challan"),
        "date": datetime.now().strftime("%d/%m/%Y"),
        "po_number": d.get("po_number", ""),
        "po_date": d.get("po_date", ""),
        "invoice_number": d.get("number", "") if src_type == "bill" else "",
        "invoice_date": d.get("date", "") if src_type == "bill" else "",
        "challan_number": "",
        "challan_date": "",
        "subject": "",
        "intro": "",
        "customer_name": d.get("customer_name", ""),
        "customer_address": d.get("customer_address", ""),
        "customer_gstin": d.get("customer_gstin", ""),
        "customer_attention": d.get("customer_attention", ""),
        "items": [
            (
                {"kind": "header", "description": it.get("description", ""), "hsn": "", "qty": 0, "unit": "", "rate": 0}
                if it.get("kind") == "header"
                else {
                    "kind": "item",
                    "description": it.get("description", ""),
                    "hsn": "",
                    "qty": it.get("qty", 0),
                    "unit": it.get("unit", "Nos"),
                    "rate": 0,
                }
            )
            for it in d.get("items", [])
        ],
        "gst_type": "none",
        "gst_rate": 0,
        "discount_percent": 0,
        "terms": {},
        "notes": "",
        "status": "draft",
        "created_at": now_utc().isoformat(),
    }
    challan["updated_at"] = challan["created_at"]
    res = await db.documents.insert_one(challan)
    created = await db.documents.find_one({"_id": res.inserted_id})
    return serialize_doc(created)


@api_router.delete("/documents/{doc_id}")
async def delete_document(doc_id: str, user: dict = Depends(get_current_user)):
    res = await db.documents.delete_one({"_id": oid(doc_id)})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Document not found")
    return {"ok": True}


# ---------------------------------------------------------------------------
# Payments (bills only)
# ---------------------------------------------------------------------------
class PaymentIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    date: str = ""          # ISO yyyy-mm-dd
    amount: float
    mode: str = "bank"      # cash / bank / upi / cheque / tds / other
    reference: str = ""
    note: str = ""


class PaymentInfoIn(BaseModel):
    due_date: str = ""      # ISO yyyy-mm-dd or empty


async def _get_bill(doc_id: str) -> dict:
    d = await db.documents.find_one({"_id": oid(doc_id)})
    if not d:
        raise HTTPException(status_code=404, detail="Document not found")
    if d.get("doc_type") != "bill":
        raise HTTPException(status_code=400, detail="Payments can only be recorded on bills")
    return d


@api_router.post("/documents/{doc_id}/payments")
async def add_payment(doc_id: str, payload: PaymentIn, user: dict = Depends(get_current_user)):
    d = await _get_bill(doc_id)
    if payload.amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be more than zero")
    total = compute_totals(d)["grand_total"]
    ps = payment_summary(d, total)
    if payload.amount > ps["balance"] + 0.01:
        raise HTTPException(
            status_code=400,
            detail=f"Amount is more than the balance due (\u20b9{ps['balance']:.2f})",
        )
    entry = {
        "id": str(ObjectId()),
        "date": payload.date or datetime.now().strftime("%Y-%m-%d"),
        "amount": round(payload.amount, 2),
        "mode": payload.mode,
        "reference": payload.reference.strip(),
        "note": payload.note.strip(),
        "recorded_at": now_utc().isoformat(),
    }
    await db.documents.update_one({"_id": d["_id"]}, {"$push": {"payments": entry}})
    return serialize_doc(await db.documents.find_one({"_id": d["_id"]}))


@api_router.delete("/documents/{doc_id}/payments/{payment_id}")
async def delete_payment(doc_id: str, payment_id: str, user: dict = Depends(get_current_user)):
    d = await _get_bill(doc_id)
    await db.documents.update_one({"_id": d["_id"]}, {"$pull": {"payments": {"id": payment_id}}})
    return serialize_doc(await db.documents.find_one({"_id": d["_id"]}))


@api_router.put("/documents/{doc_id}/payment-info")
async def set_payment_info(doc_id: str, payload: PaymentInfoIn, user: dict = Depends(get_current_user)):
    d = await _get_bill(doc_id)
    due = payload.due_date.strip()
    if due:
        try:
            datetime.fromisoformat(due)
        except ValueError:
            raise HTTPException(status_code=400, detail="Due date must look like 2026-12-31")
    await db.documents.update_one({"_id": d["_id"]}, {"$set": {"due_date": due}})
    return serialize_doc(await db.documents.find_one({"_id": d["_id"]}))


# ---------------------------------------------------------------------------
# Client files — one "folder" per client
# ---------------------------------------------------------------------------
def serialize_file(f: dict) -> dict:
    meta = f.get("metadata") or {}
    uploaded = f.get("uploadDate")
    return {
        "id": str(f["_id"]),
        "client_id": meta.get("client_id", ""),
        "category": meta.get("category") or "other",
        "filename": f.get("filename", ""),
        "size": f.get("length", 0),
        "content_type": meta.get("content_type", "application/octet-stream"),
        "uploaded_at": uploaded.isoformat() if uploaded else "",
    }


@api_router.get("/files/summary")
async def files_summary(user: dict = Depends(get_current_user)):
    """Per client: total file count/size plus a breakdown by sub-folder."""
    pipeline = [
        {"$group": {
            "_id": {"client": "$metadata.client_id", "category": "$metadata.category"},
            "count": {"$sum": 1},
            "size": {"$sum": "$length"},
        }}
    ]
    out = {}
    async for row in FILES_COLL.aggregate(pipeline):
        client_id = row["_id"].get("client")
        if not client_id:
            continue
        cat = row["_id"].get("category") or "other"
        entry = out.setdefault(client_id, {"count": 0, "size": 0, "categories": {}})
        entry["count"] += row["count"]
        entry["size"] += row["size"]
        bucket = entry["categories"].setdefault(cat, {"count": 0, "size": 0})
        bucket["count"] += row["count"]
        bucket["size"] += row["size"]
    return out


@api_router.get("/clients/{client_id}/files")
async def list_client_files(
    client_id: str,
    category: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    query = {"metadata.client_id": client_id}
    if category == "other":
        query["$or"] = [
            {"metadata.category": {"$exists": False}},
            {"metadata.category": None},
            {"metadata.category": "other"},
        ]
    elif category:
        if category not in FILE_CATEGORIES:
            raise HTTPException(status_code=400, detail="Invalid folder")
        query["metadata.category"] = category
    out = []
    async for f in FILES_COLL.find(query).sort("uploadDate", -1):
        out.append(serialize_file(f))
    return out


@api_router.post("/clients/{client_id}/files")
async def upload_client_files(
    client_id: str,
    category: str = Form(...),
    files: List[UploadFile] = File(...),
    user: dict = Depends(get_current_user),
):
    if category not in FILE_CATEGORIES:
        raise HTTPException(status_code=400, detail="Choose a sub-folder: bill, challan or quotation")
    if not await db.clients.find_one({"_id": oid(client_id)}):
        raise HTTPException(status_code=404, detail="Client not found")

    saved, rejected = [], []
    for up in files:
        name = os.path.basename(up.filename or "file").strip() or "file"
        data = await up.read(MAX_FILE_BYTES + 1)
        if len(data) > MAX_FILE_BYTES:
            rejected.append(f"{name} (larger than {MAX_FILE_BYTES // (1024 * 1024)} MB)")
            continue
        if not data:
            rejected.append(f"{name} (empty file)")
            continue
        file_id = await fs_bucket.upload_from_stream(
            name,
            data,
            metadata={
                "client_id": client_id,
                "category": category,
                "content_type": up.content_type or "application/octet-stream",
                "uploaded_by": user.get("email", ""),
            },
        )
        f = await FILES_COLL.find_one({"_id": file_id})
        saved.append(serialize_file(f))
    return {"saved": saved, "rejected": rejected}


@api_router.get("/files/{file_id}/download")
async def download_file(file_id: str, user: dict = Depends(get_current_user)):
    f = await FILES_COLL.find_one({"_id": oid(file_id)})
    if not f:
        raise HTTPException(status_code=404, detail="File not found")
    info = serialize_file(f)
    stream = await fs_bucket.open_download_stream(oid(file_id))

    async def body():
        while True:
            chunk = await stream.read(256 * 1024)
            if not chunk:
                break
            yield chunk

    headers = {
        "Content-Disposition": f"attachment; filename*=UTF-8''{quote(info['filename'])}",
        "Content-Length": str(info["size"]),
    }
    return StreamingResponse(body(), media_type=info["content_type"], headers=headers)


@api_router.delete("/files/{file_id}")
async def delete_file(file_id: str, user: dict = Depends(get_current_user)):
    if not await FILES_COLL.find_one({"_id": oid(file_id)}):
        raise HTTPException(status_code=404, detail="File not found")
    await fs_bucket.delete(oid(file_id))
    return {"ok": True}


# ---------------------------------------------------------------------------
# Purchase orders
# ---------------------------------------------------------------------------
ORDER_STATUSES = ("pending", "in_progress", "delivered", "completed", "cancelled")


class OrderIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    po_number: str = ""
    po_date: str = ""          # ISO yyyy-mm-dd
    customer_name: str = ""
    client_id: str = ""
    subject: str = ""
    order_value: float = 0
    expected_date: str = ""    # promised / expected delivery date, ISO
    status: Literal["pending", "in_progress", "delivered", "completed", "cancelled"] = "pending"
    notes: str = ""


async def serialize_orders(rows: List[dict]) -> List[dict]:
    """Adds attachments and the bills/challans/quotations that carry the same PO number."""
    ids = [str(r["_id"]) for r in rows]
    po_numbers = [r["po_number"] for r in rows if r.get("po_number")]
    attachments, linked = {}, {}
    if ids:
        async for f in FILES_COLL.find({"metadata.order_id": {"$in": ids}}):
            attachments.setdefault(f["metadata"]["order_id"], []).append(serialize_file(f))
    if po_numbers:
        async for d in db.documents.find({"po_number": {"$in": po_numbers}}):
            t = compute_totals(d)
            ps = payment_summary(d, t["grand_total"])
            linked.setdefault(d["po_number"], []).append({
                "id": str(d["_id"]),
                "doc_type": d.get("doc_type"),
                "number": d.get("number", ""),
                "grand_total": t["grand_total"],
                "payment_status": ps.get("payment_status"),
            })
    today = datetime.now().date()
    out = []
    for r in rows:
        o = dict(r)
        o["id"] = str(o.pop("_id"))
        o["attachments"] = attachments.get(o["id"], [])
        o["linked_documents"] = linked.get(o.get("po_number", ""), [])
        overdue = False
        if o.get("expected_date") and o.get("status") in ("pending", "in_progress"):
            try:
                overdue = datetime.fromisoformat(o["expected_date"]).date() < today
            except ValueError:
                pass
        o["overdue"] = overdue
        out.append(o)
    return out


@api_router.get("/orders")
async def list_orders(status: Optional[str] = None, user: dict = Depends(get_current_user)):
    query = {"status": status} if status else {}
    rows = [r async for r in db.orders.find(query).sort("created_at", -1)]
    return await serialize_orders(rows)


@api_router.post("/orders")
async def create_order(payload: OrderIn, user: dict = Depends(get_current_user)):
    data = payload.model_dump()
    data.update({"source": "manual", "created_at": now_utc().isoformat(), "updated_at": now_utc().isoformat()})
    res = await db.orders.insert_one(data)
    return (await serialize_orders([await db.orders.find_one({"_id": res.inserted_id})]))[0]


@api_router.put("/orders/{order_id}")
async def update_order(order_id: str, payload: OrderIn, user: dict = Depends(get_current_user)):
    if not await db.orders.find_one({"_id": oid(order_id)}):
        raise HTTPException(status_code=404, detail="Order not found")
    data = payload.model_dump()
    data["updated_at"] = now_utc().isoformat()
    await db.orders.update_one({"_id": oid(order_id)}, {"$set": data})
    return (await serialize_orders([await db.orders.find_one({"_id": oid(order_id)})]))[0]


@api_router.delete("/orders/{order_id}")
async def delete_order(order_id: str, user: dict = Depends(get_current_user)):
    o = await db.orders.find_one({"_id": oid(order_id)})
    if not o:
        raise HTTPException(status_code=404, detail="Order not found")
    # Attachments that belong to a client folder stay there; loose ones are removed
    async for f in FILES_COLL.find({"metadata.order_id": order_id}):
        if f["metadata"].get("client_id"):
            await FILES_COLL.update_one({"_id": f["_id"]}, {"$unset": {"metadata.order_id": ""}})
        else:
            await fs_bucket.delete(f["_id"])
    await db.orders.delete_one({"_id": oid(order_id)})
    return {"ok": True}


# ---------------------------------------------------------------------------
# Yahoo Mail (IMAP, read-only) -> purchase-order inbox
# ---------------------------------------------------------------------------
# Needs these environment variables (never stored in the database):
#   MAIL_USER           your Yahoo address
#   MAIL_APP_PASSWORD   a Yahoo *app password* (not your normal password)
# Optional: MAIL_IMAP_HOST (imap.mail.yahoo.com), MAIL_FOLDER (INBOX),
#           MAIL_KEYWORDS, MAIL_POLL_MINUTES (0 = only sync when you click the button)
MAIL_ATTACH_MAX_BYTES = 5 * 1024 * 1024
MAIL_ATTACH_TYPES = ("application/pdf", "image/", "application/vnd.", "application/msword", "text/csv")
FREE_MAIL_DOMAINS = {"gmail.com", "yahoo.com", "yahoo.co.in", "yahoo.in", "outlook.com", "hotmail.com", "rediffmail.com", "live.com", "icloud.com"}
mail_lock = asyncio.Lock()


def mail_settings() -> dict:
    return {
        "user": os.environ.get("MAIL_USER", "").strip(),
        "password": os.environ.get("MAIL_APP_PASSWORD", "").strip(),
        "host": os.environ.get("MAIL_IMAP_HOST", "imap.mail.yahoo.com").strip(),
        "folder": os.environ.get("MAIL_FOLDER", "INBOX").strip(),
        "keywords": [k.strip().lower() for k in os.environ.get(
            "MAIL_KEYWORDS", "purchase order,p.o.,po no,po #,po-,order").split(",") if k.strip()],
    }


PO_PATTERNS = [
    re.compile(r"(?:purchase\s*order|p\.?\s?o\.?)\s*(?:no\.?|number|num|#)?\s*[:#\-]?\s*([A-Z0-9][A-Z0-9\-/_.]{2,24})", re.I),
]


def guess_po_number(*texts: str) -> str:
    """Best-effort guess of the PO number. The user always confirms it before saving."""
    for text in texts:
        for pat in PO_PATTERNS:
            for m in pat.finditer(text or ""):
                cand = m.group(1).strip(".-/_")
                # needs at least one digit, otherwise it is probably a normal word
                if re.search(r"\d", cand):
                    return cand
    return ""


def html_to_text(html: str) -> str:
    html = re.sub(r"(?is)<(script|style).*?</\1>", " ", html)
    html = re.sub(r"(?i)<br\s*/?>|</p>|</div>|</tr>", "\n", html)
    text = unescape(re.sub(r"<[^>]+>", " ", html))
    return re.sub(r"[ \t]+", " ", re.sub(r"\n\s*\n+", "\n", text)).strip()


def _fetch_mail(days: int, known_ids: set, limit: int = 150) -> List[dict]:
    """Blocking IMAP work (run in a thread). Opens the mailbox read-only and uses
    BODY.PEEK, so emails are NOT marked as read in Yahoo."""
    cfg = mail_settings()
    box = imaplib.IMAP4_SSL(cfg["host"], 993, timeout=40)
    results = []
    try:
        box.login(cfg["user"], cfg["password"])
        box.select(cfg["folder"], readonly=True)
        since = (datetime.now() - timedelta(days=days)).strftime("%d-%b-%Y")
        typ, data = box.uid("search", None, "SINCE", since)
        uids = data[0].split()[-limit:] if data and data[0] else []
        for uid in reversed(uids):
            typ, hdr = box.uid("fetch", uid, "(BODY.PEEK[HEADER.FIELDS (MESSAGE-ID)])")
            head = email_lib.message_from_bytes(hdr[0][1], policy=email_policy.default) if hdr and hdr[0] else None
            message_id = (head["Message-ID"] if head else "") or f"uid-{cfg['folder']}-{uid.decode()}"
            message_id = str(message_id).strip()
            if message_id in known_ids:
                continue
            typ, raw = box.uid("fetch", uid, "(BODY.PEEK[])")
            if not raw or not raw[0]:
                continue
            msg = email_lib.message_from_bytes(raw[0][1], policy=email_policy.default)
            body_part = msg.get_body(preferencelist=("plain", "html"))
            body = ""
            if body_part is not None:
                try:
                    body = body_part.get_content()
                except Exception:
                    body = ""
                if body_part.get_content_type() == "text/html":
                    body = html_to_text(body)
            name, addr = parseaddr(str(msg.get("From", "")))
            try:
                when = parsedate_to_datetime(str(msg.get("Date"))).astimezone(timezone.utc).isoformat()
            except Exception:
                when = now_utc().isoformat()
            attachments = []
            for part in msg.iter_attachments():
                ctype = part.get_content_type()
                payload = part.get_payload(decode=True) or b""
                fname = part.get_filename() or "attachment"
                if not payload or len(payload) > MAIL_ATTACH_MAX_BYTES:
                    continue
                if not any(ctype.startswith(t) for t in MAIL_ATTACH_TYPES):
                    continue
                if ctype.startswith("image/") and len(payload) < 30 * 1024:
                    continue  # signature logos and tracking pixels
                attachments.append((os.path.basename(fname), ctype, payload))
                if len(attachments) >= 5:
                    break
            results.append({
                "message_id": message_id,
                "subject": str(msg.get("Subject", "")).strip(),
                "from_name": name,
                "from_email": addr.lower(),
                "received_at": when,
                "body": body.strip()[:4000],
                "attachments": attachments,
            })
    finally:
        try:
            box.logout()
        except Exception:
            pass
    return results


async def match_client(addr: str) -> Optional[dict]:
    """Find a client by the sender's email address, then by company domain."""
    if not addr:
        return None
    domain = addr.split("@")[-1]
    by_domain = None
    async for c in db.clients.find({"email": {"$ne": ""}}):
        emails = [e.strip().lower() for e in re.split(r"[,;/\s]+", c.get("email", "")) if "@" in e]
        if addr in emails:
            return c
        if domain not in FREE_MAIL_DOMAINS and any(e.split("@")[-1] == domain for e in emails):
            by_domain = by_domain or c
    return by_domain


async def sync_mail(days: int = 30) -> dict:
    cfg = mail_settings()
    if not (cfg["user"] and cfg["password"]):
        raise HTTPException(status_code=400, detail="Mail is not set up on the server")
    if mail_lock.locked():
        raise HTTPException(status_code=409, detail="A mail sync is already running")
    async with mail_lock:
        counts = {"checked": 0, "added": 0}
        error = ""
        try:
            known = {m["message_id"] async for m in db.mail_inbox.find({}, {"message_id": 1})}
            fetched = await asyncio.to_thread(_fetch_mail, max(1, min(days, 180)), known)
            counts["checked"] = len(fetched)
            for m in fetched:
                haystack = f"{m['subject']}\n{m['body'][:2000]}\n" + " ".join(a[0] for a in m["attachments"])
                haystack = haystack.lower()
                client = await match_client(m["from_email"])
                relevant = client is not None or any(k in haystack for k in cfg["keywords"])
                doc = {
                    "message_id": m["message_id"],
                    "status": "new" if relevant else "filtered",
                    "subject": m["subject"],
                    "from_name": m["from_name"],
                    "from_email": m["from_email"],
                    "received_at": m["received_at"],
                    "synced_at": now_utc().isoformat(),
                }
                if relevant:
                    doc.update({
                        "body": m["body"],
                        "client_id": str(client["_id"]) if client else "",
                        "client_name": client["name"] if client else "",
                        "suggested_po": guess_po_number(m["subject"], m["body"][:1500]),
                    })
                try:
                    res = await db.mail_inbox.insert_one(doc)
                except Exception:
                    continue  # duplicate message_id (unique index) - already known
                if relevant:
                    counts["added"] += 1
                    for fname, ctype, payload in m["attachments"]:
                        await fs_bucket.upload_from_stream(fname, payload, metadata={
                            "mail_id": str(res.inserted_id),
                            "client_id": doc["client_id"],
                            "category": "purchase_order",
                            "content_type": ctype,
                            "uploaded_by": "mail-sync",
                        })
        except HTTPException:
            raise
        except imaplib.IMAP4.error as e:
            error = ("Yahoo refused the login. Use a Yahoo app password (not your normal password) "
                     "and make sure MAIL_USER is your full Yahoo address.")
            logger.warning("IMAP login/protocol error: %s", type(e).__name__)
        except Exception as e:
            error = "Could not reach the mailbox. Please try again in a moment."
            logger.warning("Mail sync failed: %s", type(e).__name__)
        state = {"last_sync": now_utc().isoformat(), "last_error": error, "last_counts": counts}
        await db.mail_state.update_one({"_id": "state"}, {"$set": state}, upsert=True)
        return {**state, "ok": not error}


async def mail_poll_loop(minutes: int):
    while True:
        await asyncio.sleep(minutes * 60)
        try:
            await sync_mail(30)
        except Exception as e:  # keep the loop alive
            logger.warning("Scheduled mail sync skipped: %s", type(e).__name__)


@api_router.get("/mail/status")
async def mail_status(user: dict = Depends(get_current_user)):
    cfg = mail_settings()
    state = await db.mail_state.find_one({"_id": "state"}) or {}
    user_mask = ""
    if cfg["user"]:
        name, _, domain = cfg["user"].partition("@")
        user_mask = f"{name[:2]}***@{domain}"
    return {
        "configured": bool(cfg["user"] and cfg["password"]),
        "address": user_mask,
        "host": cfg["host"],
        "last_sync": state.get("last_sync", ""),
        "last_error": state.get("last_error", ""),
        "last_counts": state.get("last_counts", {}),
        "auto_sync_minutes": int(os.environ.get("MAIL_POLL_MINUTES", "0") or 0),
    }


@api_router.post("/mail/sync")
async def mail_sync(days: int = 30, user: dict = Depends(get_current_user)):
    return await sync_mail(days)


def serialize_mail(m: dict, files: List[dict]) -> dict:
    return {
        "id": str(m["_id"]),
        "status": m.get("status", "new"),
        "subject": m.get("subject", ""),
        "from_name": m.get("from_name", ""),
        "from_email": m.get("from_email", ""),
        "received_at": m.get("received_at", ""),
        "body": m.get("body", ""),
        "client_id": m.get("client_id", ""),
        "client_name": m.get("client_name", ""),
        "suggested_po": m.get("suggested_po", ""),
        "order_id": m.get("order_id", ""),
        "attachments": files,
    }


@api_router.get("/mail/messages")
async def list_mail(status: str = "new", user: dict = Depends(get_current_user)):
    if status not in ("new", "converted", "ignored"):
        raise HTTPException(status_code=400, detail="Invalid status")
    rows = [m async for m in db.mail_inbox.find({"status": status}).sort("received_at", -1).limit(200)]
    ids = [str(m["_id"]) for m in rows]
    files = {}
    if ids:
        async for f in FILES_COLL.find({"metadata.mail_id": {"$in": ids}}):
            files.setdefault(f["metadata"]["mail_id"], []).append(serialize_file(f))
    return [serialize_mail(m, files.get(str(m["_id"]), [])) for m in rows]


@api_router.post("/mail/messages/{mail_id}/ignore")
async def ignore_mail(mail_id: str, user: dict = Depends(get_current_user)):
    m = await db.mail_inbox.find_one({"_id": oid(mail_id)})
    if not m:
        raise HTTPException(status_code=404, detail="Email not found")
    # Free the storage used by its attachments
    async for f in FILES_COLL.find({"metadata.mail_id": mail_id}):
        await fs_bucket.delete(f["_id"])
    await db.mail_inbox.update_one({"_id": m["_id"]}, {"$set": {"status": "ignored"}})
    return {"ok": True}


@api_router.post("/mail/messages/{mail_id}/create-order")
async def mail_to_order(mail_id: str, payload: OrderIn, user: dict = Depends(get_current_user)):
    m = await db.mail_inbox.find_one({"_id": oid(mail_id)})
    if not m:
        raise HTTPException(status_code=404, detail="Email not found")
    if m.get("status") == "converted":
        raise HTTPException(status_code=400, detail="An order was already created from this email")
    data = payload.model_dump()
    if not data["po_date"]:
        data["po_date"] = (m.get("received_at") or "")[:10]
    data.update({
        "source": "email",
        "mail_id": mail_id,
        "mail_subject": m.get("subject", ""),
        "mail_from": m.get("from_email", ""),
        "created_at": now_utc().isoformat(),
        "updated_at": now_utc().isoformat(),
    })
    res = await db.orders.insert_one(data)
    order_id = str(res.inserted_id)
    set_fields = {"metadata.order_id": order_id}
    if data["client_id"]:
        set_fields["metadata.client_id"] = data["client_id"]  # shows up in the client's folder too
    await FILES_COLL.update_many({"metadata.mail_id": mail_id}, {"$set": set_fields})
    await db.mail_inbox.update_one({"_id": m["_id"]}, {"$set": {"status": "converted", "order_id": order_id}})
    return (await serialize_orders([await db.orders.find_one({"_id": res.inserted_id})]))[0]


# ---------------------------------------------------------------------------
# Startup
# ---------------------------------------------------------------------------
@app.on_event("startup")
async def startup():
    await db.users.create_index("email", unique=True)
    await db.item_catalog.create_index("key", unique=True)
    await FILES_COLL.create_index("metadata.client_id")
    await FILES_COLL.create_index("metadata.order_id", sparse=True)
    await FILES_COLL.create_index("metadata.mail_id", sparse=True)
    await db.mail_inbox.create_index("message_id", unique=True)
    await db.orders.create_index("status")
    poll = int(os.environ.get("MAIL_POLL_MINUTES", "0") or 0)
    if poll > 0 and mail_settings()["user"]:
        app.state.mail_task = asyncio.create_task(mail_poll_loop(poll))
    admin_email = os.environ.get("ADMIN_EMAIL", "admin@example.com").lower()
    admin_password = os.environ.get("ADMIN_PASSWORD", "admin123")
    existing = await db.users.find_one({"email": admin_email})
    if existing is None:
        await db.users.insert_one({
            "email": admin_email,
            "password_hash": hash_password(admin_password),
            "name": "Owner",
            "role": "admin",
            "created_at": now_utc().isoformat(),
        })
        logger.info("Seeded admin user %s", admin_email)
    elif not verify_password(admin_password, existing["password_hash"]):
        await db.users.update_one(
            {"email": admin_email},
            {"$set": {"password_hash": hash_password(admin_password)}},
        )


@app.on_event("shutdown")
async def shutdown_db_client():
    task = getattr(app.state, "mail_task", None)
    if task:
        task.cancel()
    client.close()


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)