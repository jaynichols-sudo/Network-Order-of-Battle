#!/usr/bin/env python3
"""Pushes the App Store listing (store/listing.json) and framed screenshots to App Store Connect.
usage: asc_listing.py text | screenshots <dir>
Env: ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH, MARKETING_VERSION"""
import hashlib, json, os, sys, urllib.request, urllib.error
sys.path.insert(0, os.path.dirname(__file__))
from asc_signing import call, call_soft

L = json.load(open('store/listing.json'))
BUNDLE = os.environ.get('APP_BUNDLE_ID', 'com.jaynichols.networkoob')
VERSION = os.environ.get('MARKETING_VERSION', '2.0')


def app_id():
    return call('GET', f'/apps?filter[bundleId]={BUNDLE}')['data'][0]['id']


def editable_version(app):
    vs = call('GET', f'/apps/{app}/appStoreVersions?filter[platform]=IOS&limit=20')['data']
    open_states = {'PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED', 'REJECTED', 'METADATA_REJECTED', 'INVALID_BINARY'}
    for v in vs:
        if v['attributes'].get('appStoreState') in open_states or v['attributes'].get('appVersionState') in open_states:
            if v['attributes'].get('versionString') != VERSION:
                ok, res = call_soft('PATCH', f"/appStoreVersions/{v['id']}", {'data': {'type': 'appStoreVersions', 'id': v['id'], 'attributes': {'versionString': VERSION}}})
                print('version string', VERSION, 'ok' if ok else res)
            return v['id']
    made = call('POST', '/appStoreVersions', {'data': {'type': 'appStoreVersions', 'attributes': {'platform': 'IOS', 'versionString': VERSION},
                                                         'relationships': {'app': {'data': {'type': 'apps', 'id': app}}}}})['data']
    print('created version', VERSION)
    return made['id']


def localization(version):
    locs = call('GET', f'/appStoreVersions/{version}/appStoreVersionLocalizations')['data']
    for l in locs:
        if l['attributes']['locale'] == L['locale']:
            return l['id']
    made = call('POST', '/appStoreVersionLocalizations', {'data': {'type': 'appStoreVersionLocalizations', 'attributes': {'locale': L['locale']},
                                                                    'relationships': {'appStoreVersion': {'data': {'type': 'appStoreVersions', 'id': version}}}}})['data']
    return made['id']


def text():
    app = app_id()
    loc = localization(editable_version(app))
    attrs = {k: L[k] for k in ('description', 'keywords', 'promotionalText', 'supportUrl', 'marketingUrl')}
    ok, res = call_soft('PATCH', f'/appStoreVersionLocalizations/{loc}', {'data': {'type': 'appStoreVersionLocalizations', 'id': loc, 'attributes': attrs}})
    print(f"::{'notice' if ok else 'warning'} title=App Store listing::{'Description, keywords, promo text and links updated' if ok else res}")
    review(version_id := editable_version(app))
    infos = call('GET', f'/apps/{app}/appInfos')['data']
    for info in infos:
        for il in call('GET', f"/appInfos/{info['id']}/appInfoLocalizations")['data']:
            if il['attributes']['locale'] == L['locale']:
                ok, res = call_soft('PATCH', f"/appInfoLocalizations/{il['id']}", {'data': {'type': 'appInfoLocalizations', 'id': il['id'], 'attributes': {'privacyPolicyUrl': L['privacyPolicyUrl']}}})
                print('privacy policy url', 'ok' if ok else res)


def review(version):
    """App Review contact and notes. The phone number is left to App Store Connect, where Jay enters it."""
    r = L.get('review')
    if not r:
        return
    attrs = {k: r[k] for k in ('contactFirstName', 'contactLastName', 'contactEmail', 'notes') if r.get(k)}
    attrs['demoAccountRequired'] = False
    ok, res = call_soft('GET', f'/appStoreVersions/{version}/appStoreReviewDetail')
    rid = res.get('data', {}).get('id') if ok and isinstance(res, dict) and res.get('data') else None
    if rid:
        ok, res = call_soft('PATCH', f'/appStoreReviewDetails/{rid}', {'data': {'type': 'appStoreReviewDetails', 'id': rid, 'attributes': attrs}})
    else:
        ok, res = call_soft('POST', '/appStoreReviewDetails', {'data': {'type': 'appStoreReviewDetails', 'attributes': attrs,
                                                                         'relationships': {'appStoreVersion': {'data': {'type': 'appStoreVersions', 'id': version}}}}})
    print(f"::{'notice' if ok else 'warning'} title=App Review notes::{'Review contact and notes updated' if ok else res}")


def upload(set_id, path):
    data = open(path, 'rb').read()
    made = call('POST', '/appScreenshots', {'data': {'type': 'appScreenshots', 'attributes': {'fileName': os.path.basename(path), 'fileSize': len(data)},
                                                     'relationships': {'appScreenshotSet': {'data': {'type': 'appScreenshotSets', 'id': set_id}}}}})['data']
    for op in made['attributes']['uploadOperations']:
        chunk = data[op['offset']:op['offset'] + op['length']]
        req = urllib.request.Request(op['url'], data=chunk, method=op['method'], headers={h['name']: h['value'] for h in op.get('requestHeaders', [])})
        urllib.request.urlopen(req).read()
    call('PATCH', f"/appScreenshots/{made['id']}", {'data': {'type': 'appScreenshots', 'id': made['id'],
                                                           'attributes': {'uploaded': True, 'sourceFileChecksum': hashlib.md5(data).hexdigest()}}})


def screenshots(folder):
    loc = localization(editable_version(app_id()))
    sets = call('GET', f'/appStoreVersionLocalizations/{loc}/appScreenshotSets')['data']
    for display, prefix in (('APP_IPHONE_67', 'phone'), ('APP_IPAD_PRO_3GEN_129', 'pad')):
        files = sorted(f for f in os.listdir(folder) if f.startswith(prefix + '-') and f.endswith('.png'))
        if not files:
            continue
        s = next((x for x in sets if x['attributes']['screenshotDisplayType'] == display), None)
        if s is None:
            s = call('POST', '/appScreenshotSets', {'data': {'type': 'appScreenshotSets', 'attributes': {'screenshotDisplayType': display},
                                                              'relationships': {'appStoreVersionLocalization': {'data': {'type': 'appStoreVersionLocalizations', 'id': loc}}}}})['data']
        for old in call('GET', f"/appScreenshotSets/{s['id']}/appScreenshots")['data']:
            call_soft('DELETE', f"/appScreenshots/{old['id']}")
        for f in files[:10]:
            upload(s['id'], os.path.join(folder, f))
        print(f'::notice title=App Store screenshots::Uploaded {min(len(files), 10)} {display} screenshots')


if __name__ == '__main__':
    if sys.argv[1] == 'text':
        text()
    else:
        screenshots(sys.argv[2])
