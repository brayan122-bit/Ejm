import base64, hashlib, hmac, struct

def totp_sha1(secret_b32, t_seconds, step=30, digits=6):
    counter = t_seconds // step
    key = base64.b32decode(secret_b32, casefold=True)
    msg = struct.pack(">Q", counter)
    h = hmac.new(key, msg, hashlib.sha1).digest()
    offset = h[-1] & 0x0F
    code = struct.unpack(">I", h[offset:offset+4])[0] & 0x7FFFFFFF
    return str(code % (10 ** digits)).zfill(digits)

# RFC 6238 Appendix B test key: '12345678901234567890' (20 bytes)
# Base32: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
key_b32 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"

test_vectors = [
    (59, "287082"),
    (1111111109, "081804"),
    (1111111111, "050471"),
    (1234567890, "005924"),
    (2000000000, "279037"),
    (20000000000, "353130")
]

all_passed = True
for t, expected in test_vectors:
    result = totp_sha1(key_b32, t)
    passed = (result == expected)
    if not passed: all_passed = False
    print(f"Time: {t:11d}s | Expected: {expected} | Result: {result} | Passed: {passed}")

if all_passed:
    print("\nALL 6 RFC 6238 OFFICIAL TEST VECTORS PASSED PERFECTLY!")
else:
    print("\nSOME TEST VECTORS FAILED!")
