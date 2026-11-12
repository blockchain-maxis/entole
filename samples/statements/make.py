"""
Makes fictional Nigerian bank statements as PDFs, for trying the statement
reader without real data. Every name, account and figure here is invented.

    python3 -I samples/statements/make.py

Writes, beside this file:
  - adaeze-3-months.pdf          opens without a password
  - adaeze-3-months-locked.pdf   the same statement, password "entole2026"
    (locked the way many Nigerian banks lock emailed statements: 128-bit RC4,
    PDF standard security handler revision 3)

No third-party packages: the PDF and its encryption are written by hand.
"""

import hashlib
import os
import random
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
PASSWORD = b"entole2026"


# --------------------------------------------------------------- the money

def statement_lines():
    """Three months of an invented developer's account, Aug to Oct 2026."""
    rng = random.Random(20261112)
    lines = []
    for month in (8, 9, 10):
        m = f"{month:02d}"
        lines.append((f"2026-{m}-01", "TRF TO OLUMIDE PROPERTIES RENT", 180_000_00, 0))
        lines.append((f"2026-{m}-03", "WEB NETFLIX.COM LAGOS", 4_400_00, 0))
        lines.append((f"2026-{m}-04", "POS CLAUDE.AI SUBSCRIPTION USD", 31_500_00, 0))
        lines.append((f"2026-{m}-04", "SMS ALERT CHARGES", 100_00, 0))
        lines.append((f"2026-{m}-06", "IKEJA ELECTRIC PREPAID TOKEN", 25_000_00, 0))
        lines.append((f"2026-{m}-07", "MTN DATA BUNDLE 25GB", 11_000_00, 0))
        lines.append((f"2026-{m}-08", "TRF TO MAMA NKECHI UPKEEP", 50_000_00, 0))
        for day in range(9, 28):
            if rng.random() < 0.85:
                lines.append((f"2026-{m}-{day:02d}", "POS BOLT RIDE LAGOS", rng.choice([1800, 2300, 2700, 3100]) * 100, 0))
            if rng.random() < 0.7:
                lines.append((f"2026-{m}-{day:02d}", rng.choice(["POS CHICKEN REPUBLIC", "POS SHOPRITE LEKKI", "POS COLD STONE"]), rng.choice([1500, 2200, 3500, 4800]) * 100, 0))
            if rng.random() < 0.15:
                lines.append((f"2026-{m}-{day:02d}", "ELECTRONIC MONEY TRANSFER LEVY", 50_00, 0))
        lines.append((f"2026-{m}-25", "NIP FROM BRIGHTLOOP LTD INVOICE PAYMENT", 0, 850_000_00))
        if month == 9:
            lines.append((f"2026-{m}-14", "NIP FROM UPWORK ESCROW CLIENT PAYMENT", 0, 320_000_00))
        lines.append((f"2026-{m}-28", "TRF TO PIGGYVEST SAVINGS", 60_000_00, 0))
    lines.sort(key=lambda line: line[0])
    return lines


def naira(kobo):
    return f"{kobo // 100:,}.{kobo % 100:02d}"


def day_label(day):
    year, month, date = day.split("-")
    names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    return f"{date}-{names[int(month) - 1]}-{year}"


# ------------------------------------------------------------- the pages

def pages(lines, opening):
    """Content streams, one per page: header, a table, a closing summary."""
    rows_per_page = 38
    out = []
    balance = opening
    chunks = [lines[i:i + rows_per_page] for i in range(0, len(lines), rows_per_page)]
    for index, chunk in enumerate(chunks):
        ops = []

        def text(x, y, s, size=8, bold=False):
            s = s.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
            ops.append(f"BT /{'F2' if bold else 'F1'} {size} Tf {x} {y} Td ({s}) Tj ET")

        y = 800
        if index == 0:
            text(40, y, "SANKORE BANK PLC", 14, True)
            text(40, y - 18, "Statement of Account (fictional, for testing)", 9)
            text(40, y - 34, "Account name: ADAEZE OKONKWO      Account number: 0123456789      Currency: NGN", 8)
            text(40, y - 48, "Period: 01-Aug-2026 to 31-Oct-2026", 8)
            text(40, y - 62, f"Opening balance: {naira(opening)}", 8, True)
            y -= 90
        text(40, y, "Trans Date", 8, True)
        text(110, y, "Narration", 8, True)
        text(360, y, "Debit", 8, True)
        text(430, y, "Credit", 8, True)
        text(500, y, "Balance", 8, True)
        y -= 16
        for day, narration, debit, credit in chunk:
            balance = balance - debit + credit
            text(40, y, day_label(day))
            text(110, y, narration[:42])
            text(360, y, naira(debit) if debit else "")
            text(430, y, naira(credit) if credit else "")
            text(500, y, naira(balance))
            y -= 15
        if index == len(chunks) - 1:
            text(40, y - 10, f"Closing balance: {naira(balance)}", 8, True)
        text(280, 30, f"Page {index + 1} of {len(chunks)}", 7)
        out.append("\n".join(ops).encode("latin-1"))
    return out, balance


# ----------------------------------------------------------- the PDF file

PADDING = bytes.fromhex("28BF4E5E4E758A4164004E56FFFA01082E2E00B6D0683E802F0CA9FE6453697A")


def rc4(key, data):
    s = list(range(256))
    j = 0
    for i in range(256):
        j = (j + s[i] + key[i % len(key)]) % 256
        s[i], s[j] = s[j], s[i]
    i = j = 0
    out = bytearray()
    for byte in data:
        i = (i + 1) % 256
        j = (j + s[i]) % 256
        s[i], s[j] = s[j], s[i]
        out.append(byte ^ s[(s[i] + s[j]) % 256])
    return bytes(out)


def pad(password):
    return (password + PADDING)[:32]


def security(user, owner, file_id, permissions=-3904):
    """PDF 1.4 standard security handler, revision 3, 128-bit key (Algorithms 2, 3, 5)."""
    length = 16
    # Algorithm 3: O entry.
    digest = hashlib.md5(pad(owner)).digest()
    for _ in range(50):
        digest = hashlib.md5(digest).digest()
    owner_key = digest[:length]
    o = rc4(owner_key, pad(user))
    for i in range(1, 20):
        o = rc4(bytes(b ^ i for b in owner_key), o)
    # Algorithm 2: the file key.
    p = permissions.to_bytes(4, "little", signed=True)
    digest = hashlib.md5(pad(user) + o + p + file_id).digest()
    for _ in range(50):
        digest = hashlib.md5(digest[:length]).digest()
    key = digest[:length]
    # Algorithm 5: U entry.
    u = rc4(key, hashlib.md5(PADDING + file_id).digest())
    for i in range(1, 20):
        u = rc4(bytes(b ^ i for b in key), u)
    u = u + bytes(16)
    return key, o, u, permissions


def object_key(key, number):
    return hashlib.md5(key + number.to_bytes(3, "little") + (0).to_bytes(2, "little")).digest()[: min(len(key) + 5, 16)]


def write_pdf(path, streams, password=None):
    file_id = hashlib.md5(path.encode() + b"entole").digest()
    crypt = security(password, password, file_id) if password else None
    objects = {}

    def literal(number, text):
        data = text.encode("latin-1")
        if crypt:
            return b"<" + rc4(object_key(crypt[0], number), data).hex().encode() + b">"
        return b"(" + data + b")"

    page_count = len(streams)
    first_page = 5
    kids = " ".join(f"{first_page + i * 2} 0 R" for i in range(page_count))
    objects[1] = b"<< /Type /Catalog /Pages 2 0 R >>"
    objects[2] = f"<< /Type /Pages /Kids [{kids}] /Count {page_count} >>".encode()
    objects[3] = b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"
    objects[4] = b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"
    for i, stream in enumerate(streams):
        page = first_page + i * 2
        content = page + 1
        objects[page] = (
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] "
            f"/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents {content} 0 R >>"
        ).encode()
        data = zlib.compress(stream)
        if crypt:
            data = rc4(object_key(crypt[0], content), data)
        objects[content] = f"<< /Length {len(data)} /Filter /FlateDecode >>\nstream\n".encode() + data + b"\nendstream"
    info = len(objects) + 1
    objects[info] = b"<< /Title " + literal(info, "Statement of Account (fictional)") + b" /Producer " + literal(info, "Entole sample maker") + b" >>"
    encrypt_ref = b""
    if crypt:
        enc = info + 1
        _, o, u, p = crypt
        objects[enc] = (
            f"<< /Filter /Standard /V 2 /R 3 /Length 128 /P {p} ".encode()
            + b"/O <" + o.hex().encode() + b"> /U <" + u.hex().encode() + b"> >>"
        )
        encrypt_ref = f" /Encrypt {enc} 0 R".encode()

    out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = {}
    for number in sorted(objects):
        offsets[number] = len(out)
        out += f"{number} 0 obj\n".encode() + objects[number] + b"\nendobj\n"
    xref = len(out)
    size = max(objects) + 1
    out += f"xref\n0 {size}\n0000000000 65535 f \n".encode()
    for number in range(1, size):
        out += f"{offsets[number]:010d} 00000 n \n".encode()
    out += (
        f"trailer\n<< /Size {size} /Root 1 0 R /Info {info} 0 R".encode()
        + encrypt_ref
        + b" /ID [<" + file_id.hex().encode() + b"> <" + file_id.hex().encode() + b">] >>\n"
        + f"startxref\n{xref}\n%%EOF\n".encode()
    )
    with open(path, "wb") as handle:
        handle.write(out)


def main():
    lines = statement_lines()
    opening = 412_350_00
    streams, closing = pages(lines, opening)
    write_pdf(os.path.join(HERE, "adaeze-3-months.pdf"), streams)
    write_pdf(os.path.join(HERE, "adaeze-3-months-locked.pdf"), streams, PASSWORD)
    print(f"{len(lines)} lines, {len(streams)} pages, opening {naira(opening)}, closing {naira(closing)}")


if __name__ == "__main__":
    main()
