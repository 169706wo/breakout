import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export interface ScoreRecord {
  id: string;
  name: string;
  seconds: number;
  timeFormatted: string;
  date: string;
}

const DATA_FILE = path.join(process.cwd(), "scores.json");

function getScores(): ScoreRecord[] {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      return [
        { id: "1", name: "인천대용이", seconds: 42, timeFormatted: "00:42", date: "2026-10-20" },
        { id: "2", name: "횃불이", seconds: 58, timeFormatted: "00:58", date: "2026-10-21" },
        { id: "3", name: "컴공선배", seconds: 75, timeFormatted: "01:15", date: "2026-10-22" },
      ];
    }
    const data = fs.readFileSync(DATA_FILE, "utf-8");
    return JSON.parse(data);
  } catch {
    return [];
  }
}

function saveScores(scores: ScoreRecord[]) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(scores, null, 2), "utf-8");
  } catch (err) {
    console.error("Failed to save scores:", err);
  }
}

export async function GET() {
  const scores = getScores();
  // Sort fastest first
  scores.sort((a, b) => a.seconds - b.seconds);
  return NextResponse.json({
    top3: scores.slice(0, 3),
    all: scores,
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, seconds, timeFormatted } = body;

    if (!name || seconds === undefined) {
      return NextResponse.json({ error: "Invalid data" }, { status: 400 });
    }

    const newRecord: ScoreRecord = {
      id: Date.now().toString(),
      name: String(name).trim() || "플레이어",
      seconds: Number(seconds),
      timeFormatted: timeFormatted || "00:00",
      date: new Date().toISOString(),
    };

    // Google Sheets Webhook / Apps Script 연동
    const webhookUrl = process.env.NEXT_PUBLIC_GOOGLE_SCRIPT_URL || process.env.GOOGLE_SHEET_WEBHOOK_URL;
    let googleSheetSaved = false;
    if (webhookUrl) {
      try {
        await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            timestamp: new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }),
            name: newRecord.name,
            finishtime: newRecord.timeFormatted,
            seconds: newRecord.seconds,
          }),
        });
        googleSheetSaved = true;
      } catch (e) {
        console.warn("구글 시트 웹훅 전송 실패:", e);
      }
    }

    const scores = getScores();
    scores.push(newRecord);
    scores.sort((a, b) => a.seconds - b.seconds);
    saveScores(scores);

    return NextResponse.json({
      success: true,
      top3: scores.slice(0, 3),
      googleSheetSaved,
    });
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
