import random
import string
import json
import time
from datetime import datetime, timedelta
from nanoid import generate as nanoid
from faker import Faker

# Initialize Faker
fake = Faker()

# Constants
NUM_MESSAGES = 100
REACTION_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "😡", "🔥", "🚀", "👏", "🎉"]

# Load comments from NDJSON file
def load_comments(filepath="comments.ndjson"):
    comments = []
    with open(filepath, "r", encoding="utf-8") as f:
        for line in f:
            try:
                data = json.loads(line.strip())
                # Extract 'comment' field or use the whole line if needed
                if isinstance(data, dict) and "comment" in data:
                    comments.append(data["comment"])
                else:
                    comments.append(str(data))  # fallback: use full JSON as string
            except json.JSONDecodeError:
                continue  # skip invalid lines
    return comments

# Main function to generate tweets
def generate_tweets(num_tweets):
    comments = load_comments()
    if not comments:
        raise ValueError("No valid comments found in 'comments.ndjson'")

    with open("tweets.ndjson", "w", encoding="utf-8") as f:
        for _ in range(num_tweets):
            # Generate fake name and handle
            full_name = fake.name()
            username = fake.user_name()
            handle = f"@{username}"

            # Pick a random comment from the list
            content = random.choice(comments)

            # Random timestamp in the last 30 days
            thirty_days_ago = datetime.now() - timedelta(days=30)
            random_time = thirty_days_ago + timedelta(
                seconds=random.randint(0, int((datetime.now() - thirty_days_ago).total_seconds()))
            )
            timestamp = int(random_time.timestamp() * 1000)

            # Reactions
            reactions = {emoji: random.randint(0, 20) for emoji in REACTION_EMOJIS}

            # Build tweet object
            tweet = {
                "id": nanoid(size=10),  # Unique ID
                "displayName": full_name,
                "handle": handle,
                "content": content,
                "timestamp": timestamp,
                "reactions": reactions
            }

            # Write to file
            f.write(json.dumps(tweet, ensure_ascii=False) + "\n")

    print(f"✅ Generated {num_tweets} tweets with real comments into 'tweets.ndjson'")

if __name__ == "__main__":
    generate_tweets(NUM_MESSAGES)
