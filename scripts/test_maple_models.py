#!/usr/bin/env python3
"""Quick script to test available Maple models."""

import os
import requests
import json

def main():
    api_key = os.environ.get("MAPLE_API_KEY")
    
    if not api_key:
        print("❌ MAPLE_API_KEY not found in environment")
        print("   Run: export MAPLE_API_KEY=your_key_here")
        return
    
    print(f"🔑 Using API key: {api_key[:8]}...{api_key[-4:]}")
    
    url = "http://localhost:8080/v1/models"
    headers = {"Authorization": f"Bearer {api_key}"}
    
    try:
        print(f"\n📡 Requesting: {url}")
        resp = requests.get(url, headers=headers, timeout=10)
        
        print(f"📊 Status: {resp.status_code}")
        
        if resp.status_code == 200:
            data = resp.json()
            print(f"\n✅ Available models:\n")
            
            if "data" in data:
                for model in data["data"]:
                    model_id = model.get("id", "unknown")
                    print(f"  • {model_id}")
            else:
                print(json.dumps(data, indent=2))
        else:
            print(f"❌ Error response:\n{resp.text}")
            
    except requests.exceptions.ConnectionError:
        print("❌ Connection failed - is the Maple service running on localhost:8080?")
    except Exception as e:
        print(f"❌ Error: {e}")

if __name__ == "__main__":
    main()
