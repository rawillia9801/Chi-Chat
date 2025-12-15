import { NextRequest, NextResponse } from "next/server";
import { getChiKnowledge } from "../../chiKnowledge";
import { getDistanceInMiles, calculateDeliveryFee } from "../../distance";
import { createClient } from "@supabase/supabase-js";

// Types for puppies table rows we care about
type PuppyRow = {
  puppy_name: string | null;
  call_name: string | null;
  sex: string | null;
  color: string | null;
  pattern: string | null;
  price: number | null;
  dob: string | null; // Supabase returns ISO date as string
  status: string | null;
};

// Create a Supabase client for server-side use
function createSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(
      "Supabase URL or anon key is missing. Please set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local."
    );
  }

  return createClient(url, key);
}

// Build a text context for Claude with currently available puppies
async function buildAvailablePuppiesContext(): Promise<string> {
  try {
    const supabase = createSupabaseClient();

    const { data, error } = await supabase
      .from("puppies")
      .select(
        "puppy_name, call_name, sex, color, pattern, price, dob, status"
      )
      .eq("status", "Available")
      .order("dob", { ascending: true });

    if (error) {
      console.error("Supabase puppies query error:", error);
      return `
AVAILABLE PUPPIES CONTEXT:
There was an error reading available puppies from the database.
If this happens, reply gently that you are not able to see current availability right now and suggest the customer check the Available Puppies page or contact the breeder directly.
`;
    }

    if (!data || data.length === 0) {
      return `
AVAILABLE PUPPIES CONTEXT:
The database currently shows no puppies with status "Available".
When the user asks if there are puppies available, answer kindly that there are no puppies listed as available right now, and invite them to ask about upcoming litters or the waitlist.
`;
    }

    const lines = (data as PuppyRow[]).map((p, idx) => {
      const displayName =
        p.puppy_name || p.call_name || `Puppy #${idx + 1}`;
      const sex = p.sex || "unknown sex";
      const color = p.color || "unknown color";
      const pattern = p.pattern ? `, ${p.pattern}` : "";
      const dob = p.dob ? `, born ${p.dob}` : "";
      const price =
        typeof p.price === "number" && !isNaN(p.price)
          ? ` – around $${Math.round(p.price)}`
          : "";

      return `- ${displayName} (${sex}, ${color}${pattern}${dob})${price}`;
    });

    return `
AVAILABLE PUPPIES CONTEXT:
Here are the puppies currently marked as "Available" in the Supabase puppies table:

${lines.join("\n")}

When someone asks "Do you have puppies?" or "What puppies are available?":
- Give a short, friendly answer using this list.
- Do NOT dump the full list every time. A simple reply like
  "Yes, we currently have 3 puppies available, including [one example]."
  is enough unless they ask for more detail.
- Offer to describe a specific puppy if they want, and gently mention
  that photos and full details are available on the Available Puppies
  page of the Southwest Virginia Chihuahua website.
`;
  } catch (err) {
    console.error("Error building available puppies context:", err);
    return `
AVAILABLE PUPPIES CONTEXT:
There was an unexpected error when trying to look up available puppies.
Please answer by apologizing that you can't see live availability right now and suggest they check the breeder's website or contact them directly.
`;
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const userMessage = (body?.message as string | undefined) ?? "";
    let customerName: string | null = body?.customerName ?? null;

    if (!userMessage || typeof userMessage !== "string") {
      return NextResponse.json(
        { error: "Missing 'message' in request body." },
        { status: 400 }
      );
    }

    const apiKey = process.env.CLAUDE_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "CLAUDE_API_KEY is not set on the server." },
        { status: 500 }
      );
    }

    // ------------------------------------------------------
    // Name detection – "my name is ___" or "I'm ___"
    // ------------------------------------------------------
    const namePattern = /my name is\s+([A-Za-z]+)|i['’]m\s+([A-Za-z]+)/i;
    const nameMatch = userMessage.match(namePattern);
    if (nameMatch) {
      customerName = (nameMatch[1] || nameMatch[2] || "").trim();
    }

    // ------------------------------------------------------
    // Delivery quote detection – Option A policy
    // ------------------------------------------------------
    let deliveryContext = "";
    let isRoundTrip = false;

    if (/round\s*trip|both\s*ways|there\s*and\s*back/i.test(userMessage)) {
      isRoundTrip = true;
    }

    const quoteMatch = userMessage.match(/how much.*to\s+(.+)/i);
    if (quoteMatch && quoteMatch[1]) {
      const destinationRaw = quoteMatch[1].trim();
      const destination = destinationRaw.replace(/\?+$/, "");

      try {
        const miles = await getDistanceInMiles(destination);
        if (miles !== null) {
          const milesRounded = Math.round(miles);
          const oneWayFee = Math.round(calculateDeliveryFee(miles));

          let roundTripMiles: number | null = null;
          let roundTripFee: number | null = null;

          if (isRoundTrip) {
            roundTripMiles = Math.round(miles * 2);
            roundTripFee = Math.round(calculateDeliveryFee(miles) * 2);
          }

          deliveryContext = `
DELIVERY QUOTE CONTEXT
- Destination the user asked about: "${destination}"
- Approximate one-way miles from Marion, VA: ${milesRounded} miles
- Policy A: First 50 miles free (one-way), then $1.25 per mile.
- Minimum fee when outside the free zone: $75 (one-way).
- Computed estimated one-way delivery fee: $${oneWayFee}${
            isRoundTrip && roundTripMiles !== null && roundTripFee !== null
              ? `
- User requested round-trip.
- Approximate round-trip miles: ${roundTripMiles} miles
- Estimated round-trip delivery fee (two directions): $${roundTripFee}
`
              : ""
          }

How you should answer if the user asked "how much to ${destination}":
- Give a short, friendly estimate like:
  "Based on about ${milesRounded} miles from Marion, VA, your estimated one-way delivery fee is around $${oneWayFee}."
- Mention that the first 50 miles are free and then it’s $1.25 per mile with at least a $75 fee outside the free zone.
- If the user clearly asked for round-trip, also give the round-trip estimate (${roundTripFee ?? "N/A"}).
- Do NOT dump the entire transportation policy. Just the numbers they need plus one short sentence.
- Always end with something like:
  "Final arrangements are confirmed directly with Southwest Virginia Chihuahua."
`;
        }
      } catch (err) {
        console.error("Error computing delivery quote:", err);
      }
    }

    // ------------------------------------------------------
    // Available puppies detection
    // ------------------------------------------------------
    let puppiesContext = "";
    const wantsPuppies =
      /available puppies|do you have puppies|any puppies available|what puppies do you have|what puppies are available|any litters available|any puppies right now/i.test(
        userMessage
      );

    if (wantsPuppies) {
      puppiesContext = await buildAvailablePuppiesContext();
    }

    // ------------------------------------------------------
    // System prompt / personality
    // ------------------------------------------------------
    const baseSystemPrompt = `
You are Chi-Chat, the official assistant for Southwest Virginia Chihuahua,
a small in-home Chihuahua breeder in Marion, Virginia.

VOICE & TONE:
- Warm, kind, and gentle.
- Never pushy or salesy.
- Keep answers brief and focused on exactly what the customer asked.
- Use short paragraphs. Avoid long walls of text unless the customer asks for detailed info.
- Be respectful and supportive.

GREETING BEHAVIOR:
- At the very start of a conversation, it's okay to say:
  "Hey! My name is Chi-Chat, and I'm here to help with Southwest Virginia Chihuahua questions."
- If you do not yet know their name, you may politely ask:
  "To start, what's your first name?"

NAME USAGE:
- If you know the customer's first name, use it in a natural way sometimes, like:
  "That's a great question, Sandy — I'm happy to help."
- Do NOT overuse their name; once every few replies is enough.

BOUNDARIES:
- Do NOT provide medical diagnoses or treatment plans.
- You may share general small-breed puppy care and hypoglycemia awareness, but always suggest
  that they contact a licensed veterinarian for health concerns.
- If they ask about their specific payments, portal data, or individual puppy records,
  say you cannot see their account and they should contact the breeder or log into the portal.
- If there is ever a conflict between what you say and a signed contract, the signed contract controls.
`;

    const nameContext = customerName
      ? `The customer's first name is "${customerName}". Use it occasionally in a friendly way.`
      : `You do not know the customer's name yet. If it feels natural at the start of the chat, you may politely ask for their first name once.`;

    const knowledgeText = getChiKnowledge();

    const systemPrompt = `
${baseSystemPrompt}

${nameContext}

REFERENCE INFORMATION ABOUT SOUTHWEST VIRGINIA CHIHUAHUA:
${knowledgeText}

${deliveryContext}

${puppiesContext}
`;

    // ------------------------------------------------------
    // Call Claude
    // ------------------------------------------------------
    const claudeResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-3-haiku-20240307",
        max_tokens: 600,
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }],
      }),
    });

    if (!claudeResponse.ok) {
      const errorText = await claudeResponse.text();
      console.error("Claude API error:", errorText);
      return NextResponse.json(
        { error: "Claude API error", details: errorText },
        { status: 500 }
      );
    }

    const data = await claudeResponse.json();

    let replyText = "Sorry, I had trouble generating a reply.";

    if (Array.isArray(data?.content) && data.content[0]?.text) {
      replyText = data.content[0].text;
    } else if (typeof data?.content === "string") {
      replyText = data.content;
    }

    return NextResponse.json({
      reply: replyText,
      customerName,
    });
  } catch (err) {
    console.error("Chat API error:", err);
    return NextResponse.json(
      { error: "Server error processing request." },
      { status: 500 }
    );
  }
}
