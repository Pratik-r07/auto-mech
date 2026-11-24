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
FILE_CATEGORIES = ("bill", "challan", "quotation")

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


def serialize_doc(doc: dict) -> dict:
    doc = dict(doc)
    doc["id"] = str(doc.pop("_id"))
    doc.update(compute_totals(doc))
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
    async for d in db.documents.find():
        t = compute_totals(d)
        if d.get("doc_type") == "quotation":
            quotations.append(t["grand_total"])
        elif d.get("doc_type") == "challan":
            challan_count += 1
        else:
            bills.append(t["grand_total"])
    return {
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
            {
                "description": it.get("description", ""),
                "hsn": "",
                "qty": it.get("qty", 0),
                "unit": it.get("unit", "Nos"),
                "rate": 0,
            }
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
# Startup
# ---------------------------------------------------------------------------
@app.on_event("startup")
async def startup():
    await db.users.create_index("email", unique=True)
    await db.item_catalog.create_index("key", unique=True)
    await FILES_COLL.create_index("metadata.client_id")
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
    client.close()


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)