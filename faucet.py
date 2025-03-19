import requests
import time
import json
import re
from twocaptcha import TwoCaptcha

API_KEY = '225557546a973307bf69d3079808e589'
solver = TwoCaptcha(API_KEY)

site_url = 'https://hub.0g.ai/faucet'
site_key = '1230eb62-f50c-4da4-a736-da5c3c342e8e'
url = "https://992dkn4ph6.execute-api.us-west-1.amazonaws.com/"

CLAIM_HISTORY_FILE = "claim_history.json"

# 🔹 Muat daftar alamat
with open('listaddress.txt', 'r') as file:
    addresses = file.read().splitlines()

# 🔹 Muat daftar proxy
with open('proxies.txt', 'r') as file:
    proxies_list = file.read().splitlines()

def get_proxy():
    if proxies_list:
        proxy = proxies_list.pop(0)
        proxies_list.append(proxy)
        return {"http": proxy, "https": proxy}
    return None

def load_claim_history():
    """Memuat riwayat klaim tanpa menimpa data lama."""
    try:
        with open(CLAIM_HISTORY_FILE, "r") as file:
            history = json.load(file)
        return history if isinstance(history, dict) else {}
    except (FileNotFoundError, json.JSONDecodeError):
        return {}

def save_claim_history(wallet, wait_time):
    """Menyimpan riwayat klaim tanpa menimpa wallet lain."""
    history = load_claim_history()
    history[wallet] = int(time.time() + wait_time)  # Simpan epoch time sebagai integer
    
    with open(CLAIM_HISTORY_FILE, "w") as file:
        json.dump(history, file, indent=2)  # Format JSON tetap rapi

def can_claim(wallet):
    """Cek apakah wallet bisa klaim berdasarkan waktu di claim_history.json."""
    history = load_claim_history()
    last_claim_time = history.get(wallet, 0)
    return time.time() >= last_claim_time

headers = {
    "accept": "application/json, text/plain, */*",
    "accept-encoding": "gzip, deflate, br, zstd",
    "accept-language": "en-GB,en-US;q=0.9,en;q=0.8,id;q=0.7",
    "content-type": "application/json",
    "origin": "https://hub.0g.ai",
    "referer": "https://hub.0g.ai/",
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36"
}

def extract_wait_time(response_text):
    """Ekstrak waktu tunggu dari respons dan tambahkan 1 jam ekstra."""
    match = re.search(r"Please wait (\d+) hours?", response_text)
    if match:
        wait_hours = int(match.group(1)) + 1  # Tambahkan 1 jam ekstra
        return wait_hours * 3600  # Konversi ke detik
    return None  # Jika tidak ada angka, kembalikan None

def process_wallets():
    for address in addresses:
        if not can_claim(address):
            print(f"⏳ Wallet {address} masih dalam waktu tunggu, lewati...")
            continue

        print(f"\n🚀 Memproses alamat: {address}")
        proxy = get_proxy()
        print(f"🔌 Menggunakan proxy: {proxy}")

        try:
            result = solver.hcaptcha(sitekey=site_key, url=site_url)
            hcaptcha_token = result['code']
        except Exception as e:
            print(f"❌ Error solving hCaptcha: {e}")
            continue

        payload = {
            "address": address,
            "hcaptchaToken": hcaptcha_token,
            "token": "A0GI"
        }

        try:
            response = requests.post(url, json=payload, headers=headers, proxies=proxy, timeout=30)
            print(f"📩 Response Status Code: {response.status_code}")
            print(f"📰 Response Body: {response.text}")

            if response.status_code == 200:
                print(f"✅ Faucet berhasil diklaim untuk {address}, tunggu 24 jam sebelum klaim lagi.")
                save_claim_history(address, 86400 + 3600)  # Tunggu 25 jam (24+1)
            elif response.status_code == 400:
                wait_time = extract_wait_time(response.text)
                if wait_time:
                    print(f"⏳ Wallet {address} harus menunggu {(wait_time // 3600)} jam sebelum mencoba lagi.")
                    save_claim_history(address, wait_time)
                else:
                    print(f"⚠️ Gagal klaim faucet untuk {address}, coba lagi nanti.")

        except Exception as e:
            print(f"❌ Error sending POST request: {e}")

        time.sleep(10)

if __name__ == '__main__':
    while True:
        print("\n🔄 Menjalankan ulang skrip untuk mencari wallet yang siap claim...")
        process_wallets()
        print("\n⏳ Menunggu 3 jam sebelum pengecekan ulang...")
        time.sleep(10800)  # Tunggu 3 jam sebelum menjalankan ulang

