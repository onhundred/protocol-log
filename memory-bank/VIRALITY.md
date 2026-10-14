# Virality: how Onhundred spreads

How Onhundred brings people back and gets them to share. It sits next to VOICE.md (how it sounds), DESIGN.md (how it looks) and PRODUCT.md (what it is).

Last updated: Oct 13, 2026.

## The idea

You only change your list by talking to your agent. Nothing changes by hand. So every change is a conversation. Every conversation is a chance to celebrate a win, ask a good question, or offer to share.

We aim for habit-forming and shareable, not addictive. The method promises time back. An app built to hook people would break its own rules. Our story is the opposite: the app that wants you to use it less.

## Nobody can promise viral

We can build what makes sharing likely, measure it and fix it. So growth runs as one of Ale's own experiments.

- **Question:** Will people share their progress when every agent message comes with a card?
- **Bet:** If each milestone message carries a link to a card, then 1 in 5 cards gets shared. That's because the card says something about the person without exposing anyone else.

The bet can lose. If it does, we publish that too.

## Part 1: the habit loop

What brings people back.

| Step | What happens |
| --- | --- |
| Trigger | The agent reaches out when something real happened. A round passed. You proved a loop for 3 weeks. A check-in is due. It never reaches out just to get attention |
| Action | A short talk with the agent. It's the only way to change anything |
| Reward | Something you can see changes. A tile turns green. Hours saved goes up. A loop moves up a level |
| What you build up | Your list, your history and your bets grow. Leaving would cost you all of it |

## Part 2: every moment comes with a card

The agent never just updates your list. When something happens, it talks to you about it. It congratulates you, challenges you, or tells you the honest truth. That message always comes with a link to a card.

### How a card is made

1. Something happens in your log: a round passes, a loop proves itself, a bet turns out wrong.
2. The Onhundred platform makes the card on its own, from your log. The agent doesn't draw it or write its numbers.
3. The Onhundred connector hands the agent the facts and the card link.
4. The agent writes its message and adds the link at the end, like a photo on a text.
5. The link opens a real page: the loop, the experiment or your log. For example, yourlog.com/loop/P-FIN-01?c=7Kq2xYz1.

Sharing is just forwarding that link. There's nothing to download or design.

### Where the link goes

- **A loop moment** opens the loop page. **A bet** opens the experiment page. **A check-in** opens your log.
- **A private log** has no public pages, so the link opens the card alone, at /c/7Kq2xYz1. Search engines can't find it.
- **The preview is the card.** Paste the link in WhatsApp, iMessage, LinkedIn, X or Slack and the card shows up.
- **One button to start:** "Start your 10." On a running bet: "Guess how it ends." On a loop that worked: "Steal this loop."
- **It counts views,** but not yours and not the preview bots, so we can count which cards bring people in.
- **You can take it down** at any time. The link then shows nothing. Chat apps keep previews they already showed.

### Images are made in the background

- A browser takes a picture of the card a few seconds after the moment. Until then, the link shows your log's default picture.
- One picture at a time. A failed picture stays in line and gets another try.
- **Two more sizes for posting,** made only when you ask: square (1080 × 1080) for posts, tall (1080 × 1920) for stories.
- The first time you get a card, the agent asks once: "Want a square or story version to post?" Your log page has the same offer as a button.

### The 3 kinds of messages

| Kind | When | Example message | Card |
| --- | --- | --- | --- |
| Congratulate | A round passed, a loop proved itself, 10 of 10 | "It held. Your bills got paid on time for 3 weeks. That loop is now do it, I approve." | It held |
| Challenge | Things are going well, or a loop is stuck | "3 loops are green. Your hard pick hasn't moved in 4 weeks. Want to try round 1 with a new approach?" | Your tiles today |
| Honest | A bet was wrong, a round didn't pass, you stopped one | "You bet an agent couldn't plan date night. You were wrong. That's a result, not a failure." | Wrong bet |

**Cards by moment**

| Moment | Card says | Picture |
| --- | --- | --- |
| Your list is done | "I'm handing my life to AI agents. Starting with these 10." | The 10 tiles, named |
| A first round starts | "Will it work in 14 days?" | 2 vote buttons and a day bar. The buttons are only a picture for now |
| First green tile | "My first loop is out of my hands." | The 10 tiles, with the green one lit |
| A loop proves itself for 3 weeks | "Pay monthly bills: an AI did it for 3 weeks." | The 4 levels as steps, with NOW on the new one |
| First "do it alone" | "An AI now does this alone." | The 4 steps, all lit |
| A wrong bet | "I was wrong." | The bet crossed out, what we tried and what I learned. Orange |
| A round that didn't pass | "Round 2 didn't pass. Not yet." | The rounds so far. Orange |
| A check-in | "4.5 hours a week back." | 1 big number and the 10 tiles. Light paper |
| 10 of 10 | "All 10." | The 10 tiles. Lime |

Every card shows 10 loops: the ones with the most recent activity. On a new list, the 10 that take the most hours. They're numbered in the order their first round started, so "Loop 3 of 10" stays loop 3.

Hours saved on a card always says if it's measured or estimated.

To look at every card without a deployed log, run `node scripts/card-preview.mjs` and open the files it writes.

## Part 3: what makes people talk

- **Public bets.** "Can an agent plan my date night?" Friends guess the result before it ends. Then they come back to see who was right. Guessing brings people back with no alerts.
- **Wrong bets get their own card.** Failures are funnier and more honest than wins. They get shared more.
- **Deadpan loop names.** "Dinner on the table. Risk if the AI gets it wrong: 4, according to my family." That's what people screenshot.
- **Steal this loop.** Copy someone's experiment, with their agent setup, into your list in one tap. The person you copied gets credit. Every copy brings someone new.
- **Pairs and teams.** "10 loops in 10 weeks" with a friend or your team. Same check-in day, side by side tiles.

## Part 4: the agent as a curious friend

This is where the funny, romantic and useful loops come from.

The agent asks about your life. Questions are on by default, one at a time, never during a check-in. Gap questions come first: a part of your life with no loops yet.

The first time each kind comes up, the agent adds one line: "If you'd rather I don't ask personal questions, just say so." One sentence turns that kind off.

**Examples of questions**
- "Do you have a partner? I see nothing on your relationships yet. We could plan a weekly dinner, booked and reminded for you."
- "Are you working? There's usually a lot to hand off."
- "What do you always forget for your partner?"
- "What do you dread every Sunday night?"
- "What's one thing your family complains you never do?"
- "What would you do with 2 free hours a week?"

**Examples of loops it might suggest**
- "Remember our anniversary and draft the plan a month before."
- "Get flowers ordered when a date is 2 weeks away."
- "Plan Sunday dinner so Sunday night is free."
- "Book the family trip before prices go up."

You approve every loop. The agent only suggests.

## Part 5: videos, recorded by you

People record themselves, in their own words. Onhundred doesn't make the video and doesn't write lines for anyone.

1. Next to the card link, the agent offers: "Want to plan a video about this?"
2. If you say yes, it asks 2 or 3 quick questions. Face, screen, or just your hands and the result? Funny or straight? How long?
3. It suggests 2 or 3 ideas with rough steps, not lines. For example: "Start with the bet you lost. Show the fridge. End on the number."
4. You pick one, talk it through, and record it your way.
5. The agent helps with the caption and the card link.

The connector gives the agent a video brief, never a script:
- **What happened:** the loop, the question, your bet, each round and how it ended.
- **The real numbers,** each labeled measured or estimated.
- **The story so far:** "loop 3 of 10," past wrong bets, what's next.
- **What's off limits:** anyone else's name, your kids, your partner unless they agreed, health details.
- **Assets:** the card and your link.
- **A style note:** plain words, your own voice, no hype. Funny comes from honesty, not jokes.

Every check-in is an episode. "Loop 3 of 10" makes people follow to see what happens next.

## Rewards

- The agent celebrates real results: a round passed, 3 weeks proved, hours saved.
- It challenges you when it helps: a stuck loop, a safe bet, a pick that's too easy.
- It never rewards just talking to it.
- No streaks to protect, no guilt, no "you haven't checked in."
- A wrong bet gets the same warm reply as a win. It's a result, not a failure.

## Guardrails, in code

These are rules in the agent's code, not suggestions in its prompt.

1. **Time back beats time in the app.** If app time goes up but hours saved doesn't, we failed.
2. **Questions are on by default. One sentence turns each kind off (gaps, personal, romantic).** The agent says so the first time each kind comes up.
3. **Romantic loops help you. They don't stand in for you.** The agent can remember, plan and draft. It never sends something as you to your partner unless your partner knows. That's rule III of the method.
4. **You choose what goes public.** Card pages are hidden until you share the link. A card never shows anyone else's name or details. You can turn card links off, or take any card down.
5. **The pause rule stays.** If you're working more hours, the agent suggests a pause, even if that lowers our numbers.
6. **No made-up numbers.** The platform makes every card from your log. The agent can't change it.
7. **Challenges never guilt.** The agent can push you to try harder. It never shames you for going slow or stopping.
8. **A pause is one answer away.** Say you're busy and the agent offers 2 or 4 weeks off. No challenges and no questions until it ends. Results still get their cards.

### Limits that never change

These hold whatever the settings say.

- Never ask about children's lives or anyone's health.
- Partner loops stay private until the partner agrees. No card while one is involved.
- Never act as you toward your partner. The agent can plan, remember and draft.
- Romantic ideas stay warm, never explicit.
- Never write a video script.

## What we measure

| Number | What it tells us |
| --- | --- |
| Hours saved per person | The number that must beat every other number |
| Card links opened by others | Are people forwarding the cards? |
| Share rate per milestone | Do the cards work? |
| Videos planned and posted | Is the video help useful? |
| New lists from shared links | Does sharing bring people in? |
| Loops copied with "steal this loop" | Do people learn from each other? |
| People still active after 30 days | Is the habit real? |
| Times people stop the personal questions | Are we asking too much? |

## What has to change

- **The guide and the starter sheet.** Today they tell you to edit your list by hand. With this, the agent is the only way in. The sheet becomes a view you can read but not edit.
- **The Onhundred platform.** Done: each log makes its own cards at each milestone. Links open the loop, experiment or log page, or /c/ on a private log.
- **The Onhundred connector.** Done: each write returns the moment and the card link. get_video_brief and manage_card are in.
- **The agent's playbook.** Done: docs/PLAYBOOK.md. It says when to congratulate, challenge or be honest, and which questions to ask.
- **The method PDF.** Section 13, Sharing results, needs a line on share cards and "steal this loop."
