"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import Image from "next/image";
import confetti from "canvas-confetti";
import { Play, Pause, RotateCcw, Volume2, VolumeX, Trophy, Heart, ArrowLeft, Award, Sparkles } from "lucide-react";

interface Brick {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  isRed: boolean;
  broken: boolean;
}

interface ScoreRecord {
  id: string;
  name: string;
  seconds: number;
  timeFormatted: string;
  date: string;
}

// 색상 팔레트: 파스텔/연한 톤 (요구조건: 연한 빨강, 연한 주황, 연한 노랑, 연한 파랑, 연한 녹색, 연한 보라)
const COLORS = {
  lightRed: "#FCA5A5",     // 연한 빨강 (30% 확률)
  lightOrange: "#FDBA74",  // 연한 주황
  lightYellow: "#FDE047",  // 연한 노랑
  lightGreen: "#86EFAC",   // 연한 녹색
  lightBlue: "#93C5FD",    // 연한 파랑
  lightPurple: "#D8B4FE",  // 연한 보라
};

const NON_RED_COLORS = [
  COLORS.lightOrange,
  COLORS.lightYellow,
  COLORS.lightGreen,
  COLORS.lightBlue,
  COLORS.lightPurple,
];

export default function BreakoutGame() {
  // 게임 단계: 'NAME_INPUT' | 'COUNTDOWN' | 'PLAYING' | 'PAUSED' | 'FAILED' | 'CLEARED'
  const [gameState, setGameState] = useState<
    "NAME_INPUT" | "COUNTDOWN" | "PLAYING" | "PAUSED" | "FAILED" | "CLEARED"
  >("NAME_INPUT");

  // 사용자 정보 & 작성자 고정 정보
  const [playerName, setPlayerName] = useState("");
  const authorDept = "수학과";
  const authorId = "202300246";
  const authorName = "곽해솔";

  // 게임 진행 상태
  const [lives, setLives] = useState(3);
  const [redBrokenCount, setRedBrokenCount] = useState(0);
  const [countdown, setCountdown] = useState(3);
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [finalTimeFormatted, setFinalTimeFormatted] = useState("00:00");
  const [isMuted, setIsMuted] = useState(false);
  const [top3, setTop3] = useState<ScoreRecord[]>([]);

  // 캔버스 및 물리 참조
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // 물리 게임 상태 (React state 렌더링 지연 방지)
  const gameDataRef = useRef({
    paddleX: 250,
    paddleW: 100,
    paddleH: 14,
    paddleSpeed: 8,
    ballX: 300,
    ballY: 420,
    ballRadius: 7,
    dx: 4,
    dy: -4,
    isLeftPressed: false,
    isRightPressed: false,
    canvasW: 600,
    canvasH: 520,
    bricks: [] as Brick[],
    redDestroyed: 0,
    checkmarks: [] as { x: number; y: number; life: number; maxLife: number }[],
    isPaused: false,
    isGameOver: false,
  });

  // Top 3 랭킹 불러오기
  const fetchTop3 = useCallback(async () => {
    try {
      const res = await fetch("/api/scores");
      if (res.ok) {
        const data = await res.json();
        setTop3(data.top3 || []);
      }
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => {
    fetchTop3();
  }, [fetchTop3]);

  // 효과음 생성기 (Web Audio API) - 블록 충돌 시 경쾌하고 부드러운 목탁/마림바 팝 사운드
  const playCollisionSound = useCallback((isTargetRed = false) => {
    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === "suspended") {
        ctx.resume();
      }
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      // 너무 시끄럽지 않고 둥글고 깔끔한 사인파 사운드
      osc.type = "sine";
      const startFreq = isTargetRed ? 660 : 520;
      const endFreq = isTargetRed ? 880 : 380;
      osc.frequency.setValueAtTime(startFreq, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(endFreq, ctx.currentTime + 0.07);

      // 음량 적절하게 조절 (자극적이지 않은 0.08 볼륨)
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.07);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.07);
    } catch {
      // AudioContext unavailable
    }
  }, []);

  // 패들 바운스 효과음
  const playPaddleSound = useCallback(() => {
    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === "suspended") {
        ctx.resume();
      }
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "triangle";
      osc.frequency.setValueAtTime(260, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(320, ctx.currentTime + 0.06);

      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.06);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.06);
    } catch {
      // AudioContext unavailable
    }
  }, []);

  // 벽돌 초기화 함수 (5행 × 8열 = 40개, 연한 빨강 30% 확률)
  const initBricks = useCallback(() => {
    const rows = 5;
    const cols = 8;
    const padding = 8;
    const offsetTop = 45;
    const offsetLeft = 20;
    const canvasW = gameDataRef.current.canvasW;
    const totalPadding = (cols - 1) * padding + offsetLeft * 2;
    const brickW = (canvasW - totalPadding) / cols;
    const brickH = 22;

    const bricks: Brick[] = [];
    const totalBricks = rows * cols;
    const redCountTarget = Math.round(totalBricks * 0.3); // 30% ~12개
    const redIndices = new Set<number>();

    while (redIndices.size < redCountTarget) {
      redIndices.add(Math.floor(Math.random() * totalBricks));
    }

    let index = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const isRed = redIndices.has(index);
        let color = COLORS.lightRed;
        if (!isRed) {
          const randomIndex = Math.floor(Math.random() * NON_RED_COLORS.length);
          color = NON_RED_COLORS[randomIndex];
        }

        const brickX = offsetLeft + c * (brickW + padding);
        const brickY = offsetTop + r * (brickH + padding);

        bricks.push({
          x: brickX,
          y: brickY,
          w: brickW,
          h: brickH,
          color,
          isRed,
          broken: false,
        });
        index++;
      }
    }

    gameDataRef.current.bricks = bricks;
    gameDataRef.current.redDestroyed = 0;
    gameDataRef.current.checkmarks = [];
    setRedBrokenCount(0);
  }, []);

  // 분:초 포맷터 (MM:SS)
  const formatTime = (totalSec: number) => {
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  };

  // 공 & 패들 위치 리셋
  const resetBallAndPaddle = () => {
    const data = gameDataRef.current;
    data.paddleX = (data.canvasW - data.paddleW) / 2;
    data.ballX = data.canvasW / 2;
    data.ballY = data.canvasH - 70;
    // 위쪽으로 발사 (랜덤한 좌우 약간의 각도)
    const angle = (Math.random() * 0.6 - 0.3) * Math.PI;
    const speed = 5.2;
    data.dx = Math.sin(angle) * speed;
    data.dy = -Math.cos(angle) * speed;
  };

  // 게임 시작 (이름 입력 후 클릭)
  const startGame = () => {
    if (!playerName.trim()) {
      alert("사용자 이름을 입력해주세요!");
      return;
    }

    setLives(3);
    setTimerSeconds(0);
    setRedBrokenCount(0);
    initBricks();
    resetBallAndPaddle();

    // 배경음악 준비 및 재생 (볼륨 적정하게 0.25)
    if (audioRef.current) {
      audioRef.current.volume = 0.25;
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(() => {
        // 브라우저 autoplay 방지 대응
      });
    }

    // 3, 2, 1 카운트다운 시작
    setGameState("COUNTDOWN");
    setCountdown(3);
  };

  // 카운트다운 타이머 이펙트
  useEffect(() => {
    if (gameState !== "COUNTDOWN") return;

    if (countdown > 0) {
      const timer = setTimeout(() => {
        setCountdown((prev) => prev - 1);
      }, 1000);
      return () => clearTimeout(timer);
    } else {
      // 카운트다운 종료 -> 게임 플레이 시작
      setGameState("PLAYING");
      gameDataRef.current.isPaused = false;
      gameDataRef.current.isGameOver = false;

      // 시간 측정 시작
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = setInterval(() => {
        setTimerSeconds((prev) => prev + 1);
      }, 1000);
    }
  }, [gameState, countdown]);

  // 타이머 중지 정리
  useEffect(() => {
    if (gameState !== "PLAYING") {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
    }
  }, [gameState]);

  // 미션 성공 처리 (연한 빨강 3개 제거)
  const handleMissionSuccess = useCallback(async () => {
    if (gameDataRef.current.isGameOver) return;
    gameDataRef.current.isGameOver = true;

    // BGM 일시정지
    if (audioRef.current) {
      audioRef.current.pause();
    }

    // 최종 시간 기록
    const finalSec = timerSeconds;
    const formatted = formatTime(finalSec);
    setFinalTimeFormatted(formatted);
    setGameState("CLEARED");

    // 축하 폭죽 효과
    confetti({
      particleCount: 120,
      spread: 75,
      origin: { y: 0.6 },
      colors: ["#FCA5A5", "#FDBA74", "#86EFAC", "#93C5FD", "#2E7D32", "#8B5E3C"],
    });

    // 1초 후 보너스 폭죽
    setTimeout(() => {
      confetti({
        particleCount: 90,
        angle: 60,
        spread: 55,
        origin: { x: 0 },
      });
      confetti({
        particleCount: 90,
        angle: 120,
        spread: 55,
        origin: { x: 1 },
      });
    }, 400);

    // 구글 시트 저장 및 Top3 API 호출
    try {
      const res = await fetch("/api/scores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: playerName,
          seconds: finalSec,
          timeFormatted: formatted,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.top3) setTop3(data.top3);
      }
    } catch (e) {
      console.error("점수 전송 실패:", e);
    }

    // NEXT_PUBLIC_GOOGLE_SCRIPT_URL 클라이언트 다이렉트 전송 (CORS 우회 no-cors 지원)
    const scriptUrl = process.env.NEXT_PUBLIC_GOOGLE_SCRIPT_URL;
    if (scriptUrl) {
      try {
        const payload = JSON.stringify({
          timestamp: new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }),
          name: playerName,
          finishtime: formatted,
          seconds: finalSec,
        });
        await fetch(scriptUrl, {
          method: "POST",
          mode: "no-cors",
          headers: { "Content-Type": "text/plain" },
          body: payload,
        });
      } catch (err) {
        console.warn("구글 앱스 스크립트 클라이언트 직접 호출 실패:", err);
      }
    }
  }, [playerName, timerSeconds]);

  // 미션 실패 처리 (생명 소진)
  const handleMissionFailed = useCallback(() => {
    if (gameDataRef.current.isGameOver) return;
    gameDataRef.current.isGameOver = true;

    if (audioRef.current) {
      audioRef.current.pause();
    }
    // 미션을 실패하면 시간을 측정하지 않음
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    setGameState("FAILED");
  }, []);

  // 일시정지 토글
  const togglePause = () => {
    if (gameState === "PLAYING") {
      setGameState("PAUSED");
      gameDataRef.current.isPaused = true;
      if (audioRef.current) audioRef.current.pause();
    } else if (gameState === "PAUSED") {
      // 카운트다운 없이 즉시 게임 재개
      setGameState("PLAYING");
      gameDataRef.current.isPaused = false;
      if (audioRef.current && !isMuted) audioRef.current.play().catch(() => {});
      // 타이머 재개
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = setInterval(() => {
        setTimerSeconds((prev) => prev + 1);
      }, 1000);
    }
  };

  // 게임 종료 및 이름 입력 화면 복귀
  const quitToNameInput = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    gameDataRef.current.isGameOver = true;
    setGameState("NAME_INPUT");
    fetchTop3();
  };

  // 음소거 토글
  const toggleMute = () => {
    if (audioRef.current) {
      audioRef.current.muted = !isMuted;
      setIsMuted(!isMuted);
    }
  };

  // 키보드 이벤트 핸들러 (좌우 방향키)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" || e.key === "Left") {
        gameDataRef.current.isLeftPressed = true;
      } else if (e.key === "ArrowRight" || e.key === "Right") {
        gameDataRef.current.isRightPressed = true;
      } else if (e.key === " " && (gameState === "PLAYING" || gameState === "PAUSED")) {
        // Spacebar로 일시정지 토글
        togglePause();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" || e.key === "Left") {
        gameDataRef.current.isLeftPressed = false;
      } else if (e.key === "ArrowRight" || e.key === "Right") {
        gameDataRef.current.isRightPressed = false;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [gameState]);

  // 모바일 터치 / 스와이프 제어
  const touchStartRef = useRef<number | null>(null);

  const handleTouchStart = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (e.touches.length > 0) {
      touchStartRef.current = e.touches[0].clientX;
    }
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (touchStartRef.current === null || e.touches.length === 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const touchX = e.touches[0].clientX - rect.left;
    const scale = gameDataRef.current.canvasW / rect.width;
    const targetX = touchX * scale - gameDataRef.current.paddleW / 2;

    const minX = 0;
    const maxX = gameDataRef.current.canvasW - gameDataRef.current.paddleW;
    gameDataRef.current.paddleX = Math.max(minX, Math.min(maxX, targetX));
  };

  const handleTouchEnd = () => {
    touchStartRef.current = null;
  };

  // 메인 게임 루프 (Canvas Rendering & Physics)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let localAnimationFrame: number;

    const updatePhysics = () => {
      const data = gameDataRef.current;

      // 패들 이동 (PC 좌우 방향키)
      if (data.isLeftPressed) {
        data.paddleX = Math.max(0, data.paddleX - data.paddleSpeed);
      }
      if (data.isRightPressed) {
        data.paddleX = Math.min(data.canvasW - data.paddleW, data.paddleX + data.paddleSpeed);
      }

      // 공 이동
      data.ballX += data.dx;
      data.ballY += data.dy;

      // 좌우 벽 충돌
      if (data.ballX - data.ballRadius <= 0) {
        data.ballX = data.ballRadius;
        data.dx = -data.dx;
        playPaddleSound();
      } else if (data.ballX + data.ballRadius >= data.canvasW) {
        data.ballX = data.canvasW - data.ballRadius;
        data.dx = -data.dx;
        playPaddleSound();
      }

      // 상단 벽 충돌
      if (data.ballY - data.ballRadius <= 0) {
        data.ballY = data.ballRadius;
        data.dy = -data.dy;
        playPaddleSound();
      }

      // 패들과 충돌
      const paddleTop = data.canvasH - 35;
      const paddleBottom = paddleTop + data.paddleH;
      if (
        data.ballY + data.ballRadius >= paddleTop &&
        data.ballY - data.ballRadius <= paddleBottom &&
        data.ballX >= data.paddleX - 4 &&
        data.ballX <= data.paddleX + data.paddleW + 4 &&
        data.dy > 0
      ) {
        // 충돌 위치에 따른 반사각 계산 (-60도 ~ +60도)
        const hitOffset = (data.ballX - (data.paddleX + data.paddleW / 2)) / (data.paddleW / 2);
        const maxAngle = (60 * Math.PI) / 180;
        const currentSpeed = Math.sqrt(data.dx * data.dx + data.dy * data.dy);
        const reboundAngle = hitOffset * maxAngle;

        data.dx = currentSpeed * Math.sin(reboundAngle);
        data.dy = -currentSpeed * Math.cos(reboundAngle);
        data.ballY = paddleTop - data.ballRadius;

        playPaddleSound();
      }

      // 벽돌과 충돌
      for (const b of data.bricks) {
        if (b.broken) continue;

        if (
          data.ballX + data.ballRadius >= b.x &&
          data.ballX - data.ballRadius <= b.x + b.w &&
          data.ballY + data.ballRadius >= b.y &&
          data.ballY - data.ballRadius <= b.y + b.h
        ) {
          b.broken = true;
          playCollisionSound(b.isRed);

          // 충돌 방향 계산
          const prevX = data.ballX - data.dx;
          const prevY = data.ballY - data.dy;

          if (prevX + data.ballRadius <= b.x || prevX - data.ballRadius >= b.x + b.w) {
            data.dx = -data.dx;
          } else {
            data.dy = -data.dy;
          }

          // 원하는 빨간 블록이 깨질 때 체크 표시 스폰
          if (b.isRed) {
            data.redDestroyed += 1;
            setRedBrokenCount(data.redDestroyed);

            // 체크 표시 이펙트 추가 (블록 중심 위치, 35프레임 지속)
            if (!data.checkmarks) {
              data.checkmarks = [];
            }
            data.checkmarks.push({
              x: b.x + b.w / 2,
              y: b.y + b.h / 2,
              life: 35,
              maxLife: 35,
            });

            // 3개 이상 제거 시 게임 종료 (미션 성공)
            if (data.redDestroyed >= 3) {
              handleMissionSuccess();
              return;
            }
          }
          break;
        }
      }

      // 하단으로 떨어진 경우 (생명 감소)
      if (data.ballY - data.ballRadius > data.canvasH) {
        setLives((prev) => {
          const newLives = prev - 1;
          if (newLives <= 0) {
            handleMissionFailed();
          } else {
            resetBallAndPaddle();
          }
          return newLives;
        });
      }
    };

    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const data = gameDataRef.current;

      // 캔버스 배경 (부드러운 베이지/아이보리 격자 느낌)
      ctx.fillStyle = "#FAF7F2";
      ctx.fillRect(0, 0, data.canvasW, data.canvasH);

      // 테두리
      ctx.strokeStyle = "#D1C7BD";
      ctx.lineWidth = 3;
      ctx.strokeRect(0, 0, data.canvasW, data.canvasH);

      // 벽돌 그리기
      for (const b of data.bricks) {
        if (b.broken) continue;

        ctx.save();
        ctx.fillStyle = b.color;
        ctx.beginPath();
        // 둥근 사각형
        const r = 4;
        ctx.roundRect(b.x, b.y, b.w, b.h, r);
        ctx.fill();

        // 테두리 & 입체감 그림자
        ctx.strokeStyle = b.isRed ? "#EF4444" : "rgba(100, 70, 50, 0.25)";
        ctx.lineWidth = b.isRed ? 2 : 1;
        ctx.stroke();

        ctx.restore();
      }

      // 패들 그리기 (통일된 깔끔한 단일 갈색 & 둥근 모서리)
      const paddleY = data.canvasH - 35;
      ctx.save();
      ctx.fillStyle = "#5D4037"; // 통일된 깊은 브라운 단색
      ctx.beginPath();
      ctx.roundRect(data.paddleX, paddleY, data.paddleW, data.paddleH, 7);
      ctx.fill();

      // 패들 상단 미세 은은한 브라운 하이라이트 (초록색 제거)
      ctx.fillStyle = "#795548";
      ctx.beginPath();
      ctx.roundRect(data.paddleX + 6, paddleY + 2, data.paddleW - 12, 2.5, 2);
      ctx.fill();
      ctx.restore();

      // 빨간 블록 파괴 시 체크(✔) 표시 렌더링
      if (data.checkmarks && data.checkmarks.length > 0) {
        for (let i = data.checkmarks.length - 1; i >= 0; i--) {
          const cm = data.checkmarks[i];
          const progress = 1 - cm.life / cm.maxLife; // 0 -> 1
          const alpha = Math.max(0, cm.life / cm.maxLife);
          const offsetY = progress * 16; // 위로 서서히 떠오름

          ctx.save();
          ctx.globalAlpha = alpha;
          // 체크 마크 텍스트 그리기
          ctx.font = "bold 18px sans-serif";
          ctx.fillStyle = "#16A34A"; // 선명한 체크 초록색
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("✔", cm.x, cm.y - offsetY);

          // 테두리 빛
          ctx.strokeStyle = "#FFFFFF";
          ctx.lineWidth = 1.5;
          ctx.strokeText("✔", cm.x, cm.y - offsetY);
          ctx.restore();

          cm.life -= 1;
          if (cm.life <= 0) {
            data.checkmarks.splice(i, 1);
          }
        }
      }

      // 공 그리기 (초록색 에너지 볼)
      ctx.save();
      ctx.beginPath();
      ctx.arc(data.ballX, data.ballY, data.ballRadius, 0, Math.PI * 2);
      ctx.fillStyle = "#2E7D32"; // 딥 그린
      ctx.fill();

      // 공 하이라이트 빛
      ctx.beginPath();
      ctx.arc(data.ballX - 2, data.ballY - 2, data.ballRadius * 0.4, 0, Math.PI * 2);
      ctx.fillStyle = "#A5D6A7";
      ctx.fill();
      ctx.restore();

      // 카운트다운 오버레이 표시
      if (gameState === "COUNTDOWN") {
        ctx.save();
        ctx.fillStyle = "rgba(40, 30, 20, 0.35)";
        ctx.fillRect(0, 0, data.canvasW, data.canvasH);

        ctx.fillStyle = "#FFFFFF";
        ctx.font = "bold 64px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(countdown), data.canvasW / 2, data.canvasH / 2);

        ctx.font = "bold 20px sans-serif";
        ctx.fillStyle = "#FEF3C7";
        ctx.fillText("준비하세요!", data.canvasW / 2, data.canvasH / 2 + 54);
        ctx.restore();
      }

      // 일시정지 오버레이
      if (gameState === "PAUSED") {
        ctx.save();
        ctx.fillStyle = "rgba(46, 30, 15, 0.55)";
        ctx.fillRect(0, 0, data.canvasW, data.canvasH);

        ctx.fillStyle = "#F5F5DC";
        ctx.font = "bold 32px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("일시 정지됨", data.canvasW / 2, data.canvasH / 2 - 15);

        ctx.font = "16px sans-serif";
        ctx.fillStyle = "#D7CCC8";
        ctx.fillText("재개 버튼 또는 스페이스바를 누르세요", data.canvasW / 2, data.canvasH / 2 + 25);
        ctx.restore();
      }
    };

    const loop = () => {
      if (gameState === "PLAYING") {
        updatePhysics();
      }
      render();
      localAnimationFrame = requestAnimationFrame(loop);
    };

    localAnimationFrame = requestAnimationFrame(loop);
    animationFrameRef.current = localAnimationFrame;

    return () => {
      cancelAnimationFrame(localAnimationFrame);
    };
  }, [
    gameState,
    countdown,
    handleMissionSuccess,
    handleMissionFailed,
    playCollisionSound,
    playPaddleSound,
  ]);

  return (
    <div className="min-h-screen bg-[#F7F3E9] text-[#3E2723] flex flex-col items-center justify-between font-sans selection:bg-[#2E7D32] selection:text-white pb-8">
      {/* 배경 오디오 (Hyper_Speed_Run.mp3) */}
      <audio ref={audioRef} src="/Hyper_Speed_Run.mp3" loop preload="auto" />

      {/* 상단 네비게이션 헤더 */}
      <header className="w-full bg-[#5D4037] text-[#FAF7F2] py-4 px-6 shadow-md border-b-4 border-[#2E7D32]">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="w-4 h-4 rounded-full bg-[#86EFAC] animate-pulse"></span>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-wide">
              INU 벽돌깨기
            </h1>
          </div>
        </div>
      </header>

      {/* 메인 영역 */}
      <main className="w-full max-w-4xl px-4 py-6 flex flex-col items-center flex-1 justify-center">
        {/* ===================== 1. 이름 입력 화면 ===================== */}
        {gameState === "NAME_INPUT" && (
          <div
            className="w-full max-w-md bg-[#FFFDF9] rounded-2xl shadow-xl border-2 border-[#D7CCC8] p-5 sm:p-6 flex flex-col items-center"
            style={{
              width: "100%",
              maxWidth: "420px",
              backgroundColor: "#FFFDF9",
              borderRadius: "1rem",
              border: "2px solid #D7CCC8",
              padding: "1.5rem",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1)",
              boxSizing: "border-box",
            }}
          >
            {/* 마스코트 이미지 (컴팩트하게 조정) */}
            <div
              className="relative w-24 h-24 sm:w-28 sm:h-28 mb-3 rounded-2xl overflow-hidden border-3 border-[#2E7D32] shadow-md bg-[#FAF7F2] flex items-center justify-center"
              style={{
                width: "100px",
                height: "100px",
                maxWidth: "100px",
                maxHeight: "100px",
                borderRadius: "1rem",
                overflow: "hidden",
                border: "3px solid #2E7D32",
                marginBottom: "0.75rem",
                position: "relative",
                flexShrink: 0,
              }}
            >
              <Image
                src="/Mascot.jpg"
                alt="INU 마스코트"
                width={100}
                height={100}
                priority
                className="w-full h-full object-cover"
                style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
              />
            </div>

            <h2 className="text-xl sm:text-2xl font-bold text-[#2E7D32] mb-1 text-center">
              환영합니다! INU 벽돌깨기
            </h2>
            <p className="text-xs sm:text-sm text-[#6D4C41] mb-4 text-center">
              빨강색 블록 3개를 빠르게 격파하여 최고기록에 도전하세요!
            </p>

            {/* 사용자 이름 입력 필드 */}
            <div className="w-full mb-5" style={{ width: "100%", marginBottom: "1.25rem" }}>
              <label
                htmlFor="playerName"
                className="block text-sm font-semibold text-[#5D4037] mb-2"
                style={{ display: "block", fontSize: "0.875rem", fontWeight: 600, color: "#5D4037", marginBottom: "0.5rem" }}
              >
                플레이어 이름
              </label>
              <input
                id="playerName"
                type="text"
                placeholder="이름을 입력하세요 (예: 홍길동)"
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") startGame();
                }}
                className="w-full px-4 py-3 rounded-xl border-2 border-[#BCAAA4] focus:border-[#2E7D32] focus:outline-none bg-white text-[#3E2723] text-base placeholder-[#A1887F] shadow-inner transition-colors"
                style={{
                  width: "100%",
                  padding: "0.75rem 1rem",
                  borderRadius: "0.75rem",
                  border: "2px solid #BCAAA4",
                  backgroundColor: "#ffffff",
                  color: "#3E2723",
                  fontSize: "1rem",
                  boxSizing: "border-box",
                  outline: "none",
                }}
                maxLength={15}
              />
            </div>

            {/* 게임 시작 버튼 */}
            <button
              onClick={startGame}
              className="w-full py-3.5 px-6 rounded-xl bg-[#2E7D32] hover:bg-[#1B5E20] text-white font-bold text-lg shadow-lg hover:shadow-xl transition-all transform active:scale-98 flex items-center justify-center gap-2 mb-6"
              style={{
                width: "100%",
                padding: "0.875rem 1.5rem",
                borderRadius: "0.75rem",
                backgroundColor: "#2E7D32",
                color: "#ffffff",
                fontWeight: "bold",
                fontSize: "1.125rem",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "0.5rem",
                marginBottom: "1.5rem",
                cursor: "pointer",
                border: "none",
                boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.1)",
              }}
            >
              <Play className="w-5 h-5 fill-current" style={{ width: "1.25rem", height: "1.25rem", fill: "currentColor" }} />
              게임 시작하기
            </button>

            {/* 제작자 정보 카드 */}
            <div className="w-full p-3.5 rounded-xl bg-[#F5EFEB] border border-[#D7CCC8] text-xs text-[#5D4037] mb-5">
              <div className="flex items-center gap-1.5 font-bold text-[#2E7D32] text-xs mb-2">
                <Sparkles className="w-3.5 h-3.5" /> 제작자 정보
              </div>
              <div className="flex items-center justify-around bg-[#FFFDF9] py-2 px-3 rounded-lg border border-[#E0D7D0] text-xs sm:text-sm font-semibold">
                <div><span className="text-[#8D6E63] font-normal mr-1">학과:</span>{authorDept}</div>
                <div className="w-px h-3 bg-[#D7CCC8]"></div>
                <div><span className="text-[#8D6E63] font-normal mr-1">학번:</span>{authorId}</div>
                <div className="w-px h-3 bg-[#D7CCC8]"></div>
                <div><span className="text-[#8D6E63] font-normal mr-1">이름:</span>{authorName}</div>
              </div>
            </div>

            {/* 명예의 전당 Top 3 표시 */}
            <div className="w-full">
              <div className="flex items-center gap-1.5 text-sm font-bold text-[#5D4037] mb-2">
                <Trophy className="w-4 h-4 text-amber-500 fill-amber-500" />
                명예의 전당 Top 3 (빠른 완료 시간)
              </div>
              <div className="bg-[#FAF7F2] rounded-xl border border-[#D7CCC8] divide-y divide-[#E0D7D0] overflow-hidden">
                {top3.length === 0 ? (
                  <div className="p-3 text-center text-xs text-[#8D6E63]">
                    아직 기록된 랭킹이 없습니다. 1위의 주인공이 되어보세요!
                  </div>
                ) : (
                  top3.map((record, idx) => (
                    <div key={record.id || idx} className="px-3.5 py-2.5 flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span className={`w-5 h-5 rounded-full flex items-center justify-center font-bold text-[11px] ${
                          idx === 0 ? "bg-amber-400 text-amber-950" :
                          idx === 1 ? "bg-slate-300 text-slate-800" :
                          "bg-amber-700/30 text-amber-900"
                        }`}>
                          {idx + 1}
                        </span>
                        <span className="font-semibold text-[#3E2723]">{record.name}</span>
                      </div>
                      <div className="font-mono font-bold text-[#2E7D32]">
                        {record.timeFormatted}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* ===================== 2. 게임 플레이 화면 ===================== */}
        {gameState !== "NAME_INPUT" && (
          <div className="w-full flex flex-col items-center">
            {/* 상태 표시줄 */}
            <div className="w-full max-w-[600px] bg-[#FFFDF9] rounded-xl border border-[#D7CCC8] px-4 py-2.5 mb-3 flex items-center justify-between shadow-sm text-sm">
              {/* 플레이어 및 생명 */}
              <div className="flex items-center gap-3">
                <span className="font-bold text-[#5D4037]">{playerName}</span>
                <div className="flex items-center gap-0.5">
                  {[1, 2, 3].map((heartIndex) => (
                    <Heart
                      key={heartIndex}
                      className={`w-5 h-5 ${
                        heartIndex <= lives
                          ? "text-red-500 fill-red-500"
                          : "text-stone-300 fill-stone-200"
                      }`}
                    />
                  ))}
                </div>
              </div>

              {/* 연한 빨강 미션 진행률 */}
              <div className="flex items-center gap-1.5 font-medium">
                <span className="w-3.5 h-3.5 rounded-full bg-[#FCA5A5] border border-red-500 inline-block"></span>
                <span className="text-xs sm:text-sm text-[#5D4037]">
                  빨강 블록: <strong className="text-red-600">{redBrokenCount}</strong> / 3
                </span>
              </div>

              {/* 타이머 */}
              <div className="font-mono font-bold text-base text-[#2E7D32] bg-[#E8F5E9] px-2.5 py-0.5 rounded-md border border-[#C8E6C9]">
                {gameState === "FAILED" ? "--:--" : formatTime(timerSeconds)}
              </div>
            </div>

            {/* 메인 캔버스 (게임 보드) */}
            <div className="relative shadow-2xl rounded-2xl overflow-hidden border-4 border-[#5D4037] bg-[#FAF7F2]">
              <canvas
                ref={canvasRef}
                width={600}
                height={520}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                className="w-full max-w-[600px] h-auto touch-none block"
              />

              {/* 미션 완료 오버레이 */}
              {gameState === "CLEARED" && (
                <div className="absolute inset-0 bg-[#3E2723]/75 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center animate-fade-in">
                  <div className="w-16 h-16 rounded-full bg-amber-400 flex items-center justify-center mb-3 shadow-lg">
                    <Award className="w-10 h-10 text-amber-950" />
                  </div>
                  <h3 className="text-2xl sm:text-3xl font-extrabold text-[#FEF3C7] mb-1">
                    게임 미션 완료! 🎉
                  </h3>
                  <p className="text-sm text-[#D7CCC8] mb-4">
                    빨강색 블록 3개를 모두 격파했습니다!
                  </p>
                  <div className="bg-[#2E7D32] text-white px-6 py-2.5 rounded-xl font-mono text-2xl font-black mb-6 shadow-md border-2 border-[#81C784]">
                    완료 시간: {finalTimeFormatted}
                  </div>
                  <button
                    onClick={quitToNameInput}
                    className="px-6 py-3 rounded-xl bg-[#FAF7F2] hover:bg-white text-[#3E2723] font-bold text-base shadow-lg transition-transform active:scale-95 flex items-center gap-2"
                  >
                    게임 종료
                  </button>
                </div>
              )}

              {/* 미션 실패 오버레이 */}
              {gameState === "FAILED" && (
                <div className="absolute inset-0 bg-[#3E2723]/80 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center animate-fade-in">
                  <div className="w-16 h-16 rounded-full bg-red-500/20 border-2 border-red-400 flex items-center justify-center mb-3">
                    <span className="text-3xl">💔</span>
                  </div>
                  <h3 className="text-2xl sm:text-3xl font-extrabold text-red-300 mb-2">
                    게임 미션 실패
                  </h3>
                  <p className="text-sm text-[#E0D7D0] mb-6 max-w-xs">
                    공을 모두 놓쳐 생명을 모두 소진했습니다. 다음 번에 다시 도전해보세요!
                  </p>
                  <button
                    onClick={quitToNameInput}
                    className="px-6 py-3 rounded-xl bg-[#FAF7F2] hover:bg-white text-[#3E2723] font-bold text-base shadow-lg transition-transform active:scale-95 flex items-center gap-2"
                  >
                    게임 종료
                  </button>
                </div>
              )}
            </div>

            {/* 하단 컨트롤 패널 */}
            <div className="w-full max-w-[600px] mt-4 flex items-center justify-between gap-3">
              {(gameState === "PLAYING" || gameState === "PAUSED") && (
                <button
                  onClick={togglePause}
                  className="flex-1 py-2.5 px-4 rounded-xl bg-[#5D4037] hover:bg-[#4E342E] text-white font-semibold text-sm shadow-sm transition-colors flex items-center justify-center gap-1.5"
                >
                  {gameState === "PAUSED" ? (
                    <>
                      <Play className="w-4 h-4 fill-current text-[#86EFAC]" />
                      게임 재개
                    </>
                  ) : (
                    <>
                      <Pause className="w-4 h-4 fill-current text-amber-300" />
                      일시 정지
                    </>
                  )}
                </button>
              )}

              <button
                onClick={quitToNameInput}
                className="flex-1 py-2.5 px-4 rounded-xl bg-[#C62828] hover:bg-[#B71C1C] text-white font-semibold text-sm shadow-sm transition-colors flex items-center justify-center gap-1.5"
              >
                게임 종료
              </button>
            </div>
          </div>
        )}
      </main>

      {/* 하단 푸터 */}
      <footer className="w-full text-center text-xs text-[#8D6E63] py-2">
        © 2026 INU 인천대학교 벽돌깨기 게임
      </footer>
    </div>
  );
}
