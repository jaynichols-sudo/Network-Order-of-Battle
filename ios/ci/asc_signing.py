#!/usr/bin/env python3
"""Temporary App Store signing for CI, driven by the App Store Connect API.

  setup    create a distribution certificate + App Store profile, install both,
           and write their ids to $GITHUB_ENV for cleanup
  cleanup  delete the profile and revoke the certificate created by setup

Each run gets fresh signing assets and removes them afterwards, so nothing
accumulates in the developer account. Builds already uploaded to TestFlight
are not affected by revoking the certificate.

Env: ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH, APPLE_TEAM_ID, BUNDLE_ID, RUNNER_TEMP
"""
import base64, json, os, plistlib, re, subprocess, sys, time, urllib.error, urllib.request

import jwt
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.serialization import pkcs12
from cryptography.x509.oid import NameOID

API = "https://api.appstoreconnect.apple.com/v1"


def token():
    key = open(os.environ["ASC_KEY_PATH"]).read()
    now = int(time.time())
    return jwt.encode(
        {"iss": os.environ["ASC_ISSUER_ID"], "iat": now, "exp": now + 900, "aud": "appstoreconnect-v1"},
        key, algorithm="ES256", headers={"kid": os.environ["ASC_KEY_ID"], "typ": "JWT"})


class Busy(Exception):
    pass


def call(method, path, body=None, busy_ok=False):
    req = urllib.request.Request(API + path, method=method,
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Authorization": "Bearer " + token(), "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req) as r:
            raw = r.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        if busy_ok and e.code == 409:
            raise Busy(e.read().decode()[:300])
        sys.exit(f"App Store Connect API {method} {path} failed: {e.code} {e.read().decode()[:800]}")


def create_cert(kind, csr_pem):
    """Apple allows only a few certificates of each kind at once. Another CI build
    (iPhone and Mac can overlap) holds one until it finishes, so wait for it."""
    for attempt in range(16):
        try:
            return call("POST", "/certificates", {"data": {"type": "certificates", "attributes": {
                "certificateType": kind, "csrContent": csr_pem}}}, busy_ok=True)["data"]
        except Busy as b:
            print(f"Certificate slot busy ({kind}), waiting for another build to finish… {attempt + 1}/16", flush=True)
            last = b
            time.sleep(60)
    sys.exit(f"No free {kind} certificate slot after 16 minutes: {last}. Revoke unused ones at developer.apple.com/account/resources/certificates.")


def env_out(**kv):
    with open(os.environ["GITHUB_ENV"], "a") as f:
        for k, v in kv.items():
            f.write(f"{k}={v}\n")


def setup():
    tmp = os.environ["RUNNER_TEMP"]
    run = os.environ.get("GITHUB_RUN_NUMBER", "local")

    # 1. Distribution certificate from a fresh RSA key
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    csr = (x509.CertificateSigningRequestBuilder()
           .subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, f"Bearings CI {run}"),
                                    x509.NameAttribute(NameOID.EMAIL_ADDRESS, "ci@example.invalid")]))
           .sign(key, hashes.SHA256()))
    csr_pem = csr.public_bytes(serialization.Encoding.PEM).decode()
    cert = create_cert("DISTRIBUTION", csr_pem)
    cert_id = cert["id"]
    env_out(OOB_CERT_ID=cert_id)
    der = base64.b64decode(cert["attributes"]["certificateContent"])
    certobj = x509.load_der_x509_certificate(der)
    print("Created distribution certificate", cert_id, cert["attributes"].get("name"))

    # 2. Import into a temporary keychain
    p12_pass = "ci-" + str(int(time.time()))
    # macOS `security import` only understands the legacy PKCS#12 encryption (3DES + SHA1 MAC)
    enc = (serialization.PrivateFormat.PKCS12.encryption_builder()
           .kdf_rounds(50000)
           .key_cert_algorithm(pkcs12.PBES.PBESv1SHA1And3KeyTripleDESCBC)
           .hmac_hash(hashes.SHA1())
           .build(p12_pass.encode()))
    p12 = pkcs12.serialize_key_and_certificates(b"oob", key, certobj, None, enc)
    p12_path = os.path.join(tmp, "dist.p12")
    open(p12_path, "wb").write(p12)
    kc = os.path.join(tmp, "oob-ci.keychain-db")
    kc_pass = "kc-" + p12_pass
    sh = lambda *a: subprocess.run(a, check=True)
    sh("security", "create-keychain", "-p", kc_pass, kc)
    sh("security", "set-keychain-settings", "-lut", "21600", kc)
    sh("security", "unlock-keychain", "-p", kc_pass, kc)
    sh("security", "import", p12_path, "-k", kc, "-P", p12_pass, "-T", "/usr/bin/codesign", "-T", "/usr/bin/security")
    sh("security", "set-key-partition-list", "-S", "apple-tool:,apple:,codesign:", "-s", "-k", kc_pass, kc)
    existing = subprocess.run(["security", "list-keychains", "-d", "user"], capture_output=True, text=True).stdout
    chains = [c.strip().strip('"') for c in existing.split("\n") if c.strip()]
    sh("security", "list-keychains", "-d", "user", "-s", kc, *chains)
    env_out(OOB_KEYCHAIN=kc)

    # 3. App Store profiles. BUNDLE_IDS is "APP=com.x,WATCH=com.x.watchkitapp,..."; plain BUNDLE_ID still works.
    spec = os.environ.get("BUNDLE_IDS") or ("APP=" + os.environ["BUNDLE_ID"])
    pairs = [p.split("=", 1) for p in spec.split(",") if "=" in p]
    ids, names, mapping = [], {}, {}
    for role, bid in pairs:
        found = call("GET", f"/bundleIds?filter[identifier]={bid}&limit=200")["data"]
        found = [b for b in found if b["attributes"]["identifier"] == bid]
        if found:
            bundle = found[0]
        else:
            bundle = call("POST", "/bundleIds", {"data": {"type": "bundleIds", "attributes": {
                "identifier": bid, "name": "Bearings " + role.title(), "platform": "IOS"}}})["data"]
            print("Registered bundle ID", bid)
        name = f"Bearings CI {role} {run}"
        prof = call("POST", "/profiles", {"data": {"type": "profiles",
            "attributes": {"name": name, "profileType": os.environ.get("PROFILE_TYPE", "IOS_APP_STORE")},
            "relationships": {"bundleId": {"data": {"type": "bundleIds", "id": bundle["id"]}},
                              "certificates": {"data": [{"type": "certificates", "id": cert_id}]}}}})["data"]
        ids.append(prof["id"])
        names[role] = name
        mapping[bid] = name
        content = base64.b64decode(prof["attributes"]["profileContent"])
        uuid = prof["attributes"]["uuid"]
        for d in ["~/Library/MobileDevice/Provisioning Profiles", "~/Library/Developer/Xcode/UserData/Provisioning Profiles"]:
            d = os.path.expanduser(d)
            os.makedirs(d, exist_ok=True)
            open(os.path.join(d, uuid + ".mobileprovision"), "wb").write(content)
        print("Created and installed profile", name, uuid)
    if os.environ.get("INSTALLER_CERT"):
        installer(kc, kc_pass, tmp, run)
    env_out(OOB_PROFILE_IDS=",".join(ids), OOB_PROFILE_MAP=json.dumps(mapping),
            **{"OOB_PROFILE_" + r: n for r, n in names.items()},
            OOB_PROFILE_NAME=names.get("APP", ""))


def installer(kc, kc_pass, tmp, run):
    """A Mac Installer Distribution certificate, for signing the Mac app's upload package."""
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    csr = (x509.CertificateSigningRequestBuilder()
           .subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, f"Bearings CI installer {run}")]))
           .sign(key, hashes.SHA256()))
    cert = create_cert("MAC_INSTALLER_DISTRIBUTION", csr.public_bytes(serialization.Encoding.PEM).decode())
    env_out(OOB_INSTALLER_CERT_ID=cert["id"])
    certobj = x509.load_der_x509_certificate(base64.b64decode(cert["attributes"]["certificateContent"]))
    p12_pass = "ci-inst-" + str(int(time.time()))
    enc = (serialization.PrivateFormat.PKCS12.encryption_builder().kdf_rounds(50000)
           .key_cert_algorithm(pkcs12.PBES.PBESv1SHA1And3KeyTripleDESCBC).hmac_hash(hashes.SHA1()).build(p12_pass.encode()))
    path = os.path.join(tmp, "installer.p12")
    open(path, "wb").write(pkcs12.serialize_key_and_certificates(b"installer", key, certobj, None, enc))
    subprocess.run(["security", "import", path, "-k", kc, "-P", p12_pass, "-T", "/usr/bin/productbuild", "-T", "/usr/bin/codesign", "-T", "/usr/bin/security"], check=True)
    subprocess.run(["security", "set-key-partition-list", "-S", "apple-tool:,apple:,codesign:,productbuild:", "-s", "-k", kc_pass, kc], check=True)
    cn = certobj.subject.get_attributes_for_oid(NameOID.COMMON_NAME)[0].value
    env_out(OOB_INSTALLER_NAME=cn)
    print("Created installer certificate", cert["id"], cn)


def cleanup():
    pids = [p for p in (os.environ.get("OOB_PROFILE_IDS") or os.environ.get("OOB_PROFILE_ID") or "").split(",") if p]
    cid = os.environ.get("OOB_CERT_ID")
    icid = os.environ.get("OOB_INSTALLER_CERT_ID")
    if icid:
        call_soft("DELETE", f"/certificates/{icid}")
        print("Revoked installer certificate", icid)
    for pid in pids:
        call("DELETE", f"/profiles/{pid}")
        print("Deleted profile", pid)
    if cid:
        call("DELETE", f"/certificates/{cid}")
        print("Revoked certificate", cid)
    kc = os.environ.get("OOB_KEYCHAIN")
    if kc and os.path.exists(kc):
        subprocess.run(["security", "delete-keychain", kc])


def patch_project():
    """Switch the App target (not the Swift packages) to manual App Store signing."""
    p = "ios/App/App.xcodeproj/project.pbxproj"
    s = open(p).read()
    team, name = os.environ["APPLE_TEAM_ID"], os.environ["OOB_PROFILE_NAME"]
    n = 0

    def fix(m):
        nonlocal n
        block = m.group(0)
        if "PRODUCT_BUNDLE_IDENTIFIER" not in block:
            return block
        n += 1
        block = re.sub(r"\n(\t+)CODE_SIGN_STYLE = Automatic;",
                       lambda mm: (f"\n{mm.group(1)}CODE_SIGN_STYLE = Manual;"
                                   f"\n{mm.group(1)}DEVELOPMENT_TEAM = {team};"
                                   f"\n{mm.group(1)}\"CODE_SIGN_IDENTITY[sdk=iphoneos*]\" = \"Apple Distribution\";"
                                   f"\n{mm.group(1)}PROVISIONING_PROFILE_SPECIFIER = \"{name}\";"), block)
        return block

    s = re.sub(r"buildSettings = \{.*?\n\t\t\t\};", fix, s, flags=re.S)
    if n == 0:
        sys.exit("Could not find the App target build settings to patch")
    open(p, "w").write(s)
    print(f"Patched {n} App target configurations for manual signing")


def call_soft(method, path, body=None):
    """Like call(), but returns (ok, json-or-error-text) instead of exiting."""
    req = urllib.request.Request(API + path, method=method,
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Authorization": "Bearer " + token(), "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req) as r:
            raw = r.read()
            return True, (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as e:
        return False, e.read().decode()[:600]


def rename():
    """Sets the App Store name (first available of NAMES) and subtitle. Safe to run every build."""
    bid = os.environ.get("APP_BUNDLE_ID", "com.jaynichols.networkoob")
    names = [n.strip() for n in os.environ.get("NAMES", "Bearings").split("|") if n.strip()]
    subtitle = os.environ.get("SUBTITLE", "")
    app = call("GET", f"/apps?filter[bundleId]={bid}")["data"][0]
    infos = call("GET", f"/apps/{app['id']}/appInfos")["data"]
    editable = [i for i in infos if i["attributes"].get("appStoreState", i["attributes"].get("state", "")) not in ("READY_FOR_SALE", "READY_FOR_DISTRIBUTION", "REPLACED_WITH_NEW_INFO")] or infos
    info = editable[0]
    locs = call("GET", f"/appInfos/{info['id']}/appInfoLocalizations")["data"]
    for loc in locs:
        cur = loc["attributes"].get("name") or ""
        if cur in names and (not subtitle or loc["attributes"].get("subtitle") == subtitle):
            print(f"::notice title=App Store name::Already '{cur}' ({loc['attributes'].get('locale')})")
            continue
        done = False
        for n in names:
            attrs = {"name": n}
            if subtitle: attrs["subtitle"] = subtitle
            ok, res = call_soft("PATCH", f"/appInfoLocalizations/{loc['id']}", {"data": {"type": "appInfoLocalizations", "id": loc["id"], "attributes": attrs}})
            if ok:
                print(f"::notice title=App Store name::Renamed '{cur}' to '{n}' ({loc['attributes'].get('locale')})")
                done = True
                break
            print(f"'{n}' not accepted: {res}")
        if not done:
            print(f"::warning title=App Store name::None of {names} were accepted. Still '{cur}'.")


def status():
    """Waits for App Store Connect to finish processing this build and reports the result."""
    bid, build = os.environ.get("APP_BUNDLE_ID", "com.jaynichols.networkoob"), os.environ["BUILD_NUMBER"]
    app = call("GET", f"/apps?filter[bundleId]={bid}")["data"][0]["id"]
    state = "NOT FOUND"
    for _ in range(40):
        data = call("GET", f"/builds?filter[app]={app}&filter[version]={build}&limit=5")["data"]
        if data:
            state = data[0]["attributes"].get("processingState", "?")
            if state in ("VALID", "INVALID", "FAILED"):
                break
        time.sleep(20)
    kind = "notice" if state == "VALID" else "warning"
    print(f"::{kind} title=TestFlight processing::Build {build} is {state}")


if __name__ == "__main__":
    {"setup": setup, "cleanup": cleanup, "patch": patch_project, "status": status, "rename": rename}[sys.argv[1]]()
