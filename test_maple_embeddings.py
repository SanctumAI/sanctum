#!/usr/bin/env python3
"""
Simple test script to check if Maple Proxy supports embeddings.

Usage:
    python test_maple_embeddings.py

Requires:
    - Maple Proxy running (desktop app or docker)
    - MAPLE_API_KEY in .env file (or desktop app handles it)
"""

import os
import httpx
from dotenv import load_dotenv
from openai import OpenAI

# Load environment variables from .env file
load_dotenv()

# Configuration
MAPLE_BASE_URL = os.getenv("MAPLE_BASE_URL", "http://localhost:8080/v1")
MAPLE_API_KEY = os.getenv("MAPLE_API_KEY", "not-required")

# Initialize client pointing to Maple (for listing models)
client = OpenAI(
    base_url=MAPLE_BASE_URL,
    api_key=MAPLE_API_KEY
)

def list_models():
    """List available models to see what's supported."""
    print("=== Available Models ===")
    try:
        models = client.models.list()
        for model in models.data:
            print(f"  - {model.id}")
        return [m.id for m in models.data]
    except Exception as e:
        print(f"Error listing models: {e}")
        return []

def test_embedding(model: str, text: str):
    """Attempt to create an embedding using raw HTTP (OpenAI SDK has issues with Maple)."""
    print(f"\n=== Testing Embedding ===")
    print(f"Model: {model}")
    print(f"Text: {text[:50]}...")
    
    try:
        response = httpx.post(
            f"{MAPLE_BASE_URL}/embeddings",
            headers={
                "Authorization": f"Bearer {MAPLE_API_KEY}",
                "Content-Type": "application/json"
            },
            json={"model": model, "input": [text]},
            timeout=30.0
        )
        response.raise_for_status()
        data = response.json()
        embedding = data["data"][0]["embedding"]
        print(f"✓ Success! Embedding dimension: {len(embedding)}")
        print(f"  First 5 values: {embedding[:5]}")
        return embedding
    except Exception as e:
        print(f"✗ Error: {e}")
        return None

def benchmark_embeddings(model: str, sentences: list[str]):
    """Benchmark embedding multiple sentences individually."""
    import time
    
    print(f"\n=== Benchmark: {len(sentences)} sentences ===")
    print(f"Model: {model}\n")
    
    embeddings = []
    start_time = time.time()
    
    for i, sentence in enumerate(sentences):
        try:
            response = httpx.post(
                f"{MAPLE_BASE_URL}/embeddings",
                headers={
                    "Authorization": f"Bearer {MAPLE_API_KEY}",
                    "Content-Type": "application/json"
                },
                json={"model": model, "input": [sentence]},
                timeout=30.0
            )
            response.raise_for_status()
            data = response.json()
            embedding = data["data"][0]["embedding"]
            embeddings.append(embedding)
            
            # Progress indicator every 10 sentences
            if (i + 1) % 10 == 0:
                elapsed = time.time() - start_time
                print(f"  [{i+1}/{len(sentences)}] {elapsed:.2f}s elapsed")
        except Exception as e:
            print(f"  Error on sentence {i+1}: {e}")
            embeddings.append(None)
    
    total_time = time.time() - start_time
    successful = sum(1 for e in embeddings if e is not None)
    
    print(f"\n=== Results ===")
    print(f"Total time: {total_time:.2f}s")
    print(f"Successful: {successful}/{len(sentences)}")
    print(f"Avg per sentence: {total_time/len(sentences)*1000:.1f}ms")
    print(f"Throughput: {len(sentences)/total_time:.1f} sentences/sec")
    
    return embeddings, total_time


# A basic story about Bitcoin and freedom - 100 sentences
STORY = """
Satoshi sat alone in a dimly lit room staring at lines of code.
The year was 2008 and the financial world was crumbling around him.
Banks were failing one after another like dominoes in a storm.
He knew there had to be a better way to handle money.
Trust had been broken between people and institutions.
What if money could exist without trusting any central authority?
He began typing faster as the idea crystallized in his mind.
A peer-to-peer electronic cash system could change everything.
No banks needed to verify transactions between strangers.
Cryptography would do what trust could not.
He called his creation Bitcoin after the digital bits it comprised.
The whitepaper was just nine pages but contained a revolution.
Each transaction would be verified by a network of computers.
Miners would compete to add blocks to an ever-growing chain.
The blockchain would be transparent yet pseudonymous.
Anyone could verify but no one could cheat the system.
On January 3rd 2009 the genesis block was mined.
Hidden in that first block was a message from Satoshi.
It referenced a newspaper headline about bank bailouts.
The timing was no coincidence but a statement of purpose.
Hal Finney received the first Bitcoin transaction ten days later.
He was excited about the potential of this new technology.
Others dismissed it as a toy for cryptographers.
But Satoshi kept improving the code day after day.
The community slowly grew around this strange new money.
Pizza was purchased for ten thousand bitcoins in 2010.
At the time it seemed like a fair trade for two pies.
Today those coins would be worth hundreds of millions.
Satoshi continued posting on forums and answering questions.
Then one day the creator simply vanished without a trace.
No one knows if Satoshi was one person or many.
The mystery only added to Bitcoin's mystique.
Without its creator the network kept running perfectly.
This proved that decentralization actually worked.
No single point of failure could bring it down.
Governments began to take notice of this phenomenon.
Some tried to ban it while others embraced it.
But Bitcoin proved resilient against all attacks.
The price crashed multiple times and always recovered.
Each cycle brought new believers into the fold.
HODLers learned to ignore the short-term volatility.
They understood they were investing in a new paradigm.
Money that no government could print or confiscate.
This was especially important in countries with unstable currencies.
In Venezuela people used Bitcoin to escape hyperinflation.
In Nigeria it helped people bypass capital controls.
Activists in Hong Kong donated anonymously for their cause.
The Lightning Network made small payments possible.
Now coffee could be bought with Bitcoin instantly.
Layer two solutions addressed the scaling concerns.
The network processed millions of transactions every day.
Institutions that once mocked Bitcoin began buying it.
Tesla put Bitcoin on their balance sheet.
El Salvador made it legal tender for their nation.
Other countries watched closely and considered following.
The old financial system was showing its age.
Bitcoin offered an alternative built for the digital age.
Programmable money that worked the same everywhere.
No borders could stop a Bitcoin transaction.
No bank could freeze your account without reason.
Self-custody meant true ownership of your wealth.
Not your keys meant not your coins.
Hardware wallets kept private keys safe from hackers.
Multi-signature setups provided additional security.
The technology kept evolving year after year.
Taproot brought smart contracts to Bitcoin.
Privacy improvements made transactions harder to trace.
The cypherpunks dream was becoming reality.
A world where financial freedom was a right not a privilege.
Where surveillance of transactions was opt-in not mandatory.
Where inflation could not secretly steal your savings.
Bitcoin mining became an industry worth billions.
Renewable energy found a buyer of last resort.
Stranded natural gas could power mining operations.
The environmental concerns were being addressed creatively.
Heat from mining warmed homes and greenhouses.
The energy usage funded innovation in renewables.
Critics still called it a bubble destined to pop.
But each year Bitcoin grew stronger and more adopted.
The Lindy effect suggested it would outlast its critics.
Twenty years from now it might be everywhere.
A savings technology for billions of unbanked people.
A hedge against currency debasement for everyone.
The financial revolution had been coded into existence.
Satoshi may be gone but the mission continues.
Thousands of developers work on Bitcoin every day.
Millions of node operators verify every transaction.
Billions of dollars flow through the network constantly.
The experiment that started in a cypherpunk mailing list.
Has become one of the most valuable assets on Earth.
And it all began with someone asking a simple question.
What if we could have money without middlemen?
The answer changed the world forever.
Bitcoin is hope encoded in mathematics.
It represents freedom from financial oppression.
A tool for knowledge management in the digital age.
The peaceful revolution continues block by block.
Every ten minutes a new page of history is written.
The blockchain never forgets and never stops.
This is the story of money being reinvented.
From atoms to bits from trust to verification.
The future of finance is being built right now.
And anyone can participate in this transformation.
All you need is an internet connection and curiosity.
""".strip().split('\n')

if __name__ == "__main__":
    print(f"Maple Proxy URL: {MAPLE_BASE_URL}\n")
    
    # First, list available models
    available_models = list_models()
    
    # Look for nomic model in available list
    nomic_model = next((m for m in available_models if "nomic" in m.lower()), None)
    test_model = nomic_model or "nomic-embed-text"
    
    # Clean up story sentences
    sentences = [s.strip() for s in STORY if s.strip()]
    print(f"\nStory has {len(sentences)} sentences")
    
    # Run benchmark
    benchmark_embeddings(test_model, sentences)
