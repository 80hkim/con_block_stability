/**
 * visualization.js — 콘크리트 블록식 안벽 단면도 시각화
 * KDS 64 55 20 기준
 */
class QuayWallVisualization {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.scale = 40;
        this.offsetX = 50;
        this.offsetY = -30;
        this.showDimensions = true;
        this.showForces = false;
        this.showLabels = true;
        this.showWaterLevels = true;
        this.showLabelPave = true;
        this.showLabelSub = true;
        this.showLabelFoundation = true;
        this.showLabelFilter = true;
        this.showLabelBackfill = true;
        this.showLabelFill = true;
        this.showLabelArmor = false;
        this.showCL = false;
        this.isDragging = false;
        this.lastMouse = { x: 0, y: 0 };
        this._rafPending = false; // 최적화: rAF 스로틀 플래그

        this.colors = {
            cap: '#7b8fa8', capStroke: '#5a6f88', capLight: '#c8d8e8',
            water: 'rgba(65, 155, 215, 0.35)', dimLines: '#ffffff', // 흰색 치수선
            yellow: '#ffffff', 
        };
        this.blockColors = [
            { fill: '#8899aa', stroke: '#667788', light: '#c0d0e0' },
            { fill: '#7a8fa4', stroke: '#5a6f84', light: '#b8c8d8' },
            { fill: '#6c859e', stroke: '#4c6580', light: '#a8b8d0' },
            { fill: '#5e7b98', stroke: '#3e5b78', light: '#98a8c8' },
        ];

        this._initEvents();
        this._resizeCanvas();
    }

    // [최적화: requestAnimationFrame 스로틀로 드래그/휠 시 과도한 redraw 방지]
    _scheduleRedraw() {
        if (this._rafPending) return;
        this._rafPending = true;
        requestAnimationFrame(() => {
            this._rafPending = false;
            if (this._lastData) this.draw(this._lastData);
        });
    }

    _initEvents() {
        window.addEventListener('resize', () => this._resizeCanvas());
        const container = this.canvas.parentElement;
        if (container) {
            new ResizeObserver(() => this._resizeCanvas()).observe(container);
        }
        this.canvas.addEventListener('mousedown', (e) => { this.isDragging = true; this.lastMouse = { x: e.clientX, y: e.clientY }; });
        this.canvas.addEventListener('mousemove', (e) => {
            if (!this.isDragging) return;
            this.offsetX += e.clientX - this.lastMouse.x;
            this.offsetY += e.clientY - this.lastMouse.y;
            this.lastMouse = { x: e.clientX, y: e.clientY };
            this._scheduleRedraw();
        });
        this.canvas.addEventListener('mouseup', () => { this.isDragging = false; });
        this.canvas.addEventListener('mouseleave', () => { this.isDragging = false; });
        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -3 : 3;
            this.scale = Math.max(15, Math.min(100, this.scale + delta));
            this._scheduleRedraw();
        });
    }

    _resizeCanvas() {
        const container = this.canvas.parentElement;
        this.canvas.width = container.clientWidth;
        this.canvas.height = container.clientHeight;
        if (this._lastData) this.draw(this._lastData);
    }

    zoomIn() { this.scale = Math.min(100, this.scale + 5); if (this._lastData) this.draw(this._lastData); }
    zoomOut() { this.scale = Math.max(15, this.scale - 5); if (this._lastData) this.draw(this._lastData); }
    fitView() {
        const resultsPanel = document.getElementById('results-panel');
        if (resultsPanel && resultsPanel.classList.contains('collapsed')) {
            // 주구조물이 화면 중앙에 오도록 배치
            this.scale = 40;
            this.offsetX = 50;
            this.offsetY = -30;
        } else {
            // 결과창 올렸을 때 (결과표에 가리지 않는 구도)
            this.scale = 35;
            this.offsetX = 50;
            this.offsetY = 60;
        }
        if (this._lastData) this.draw(this._lastData);
    }

    wx(worldX) { return this.originX + worldX * this.scale + this.offsetX; }
    wy(worldY) { return this.originY - worldY * this.scale + this.offsetY; }

    _dlSign(dlVal) {
        if (Math.abs(dlVal) < 0.001) return '(±)';
        return dlVal > 0 ? '(+)' : '(-)';
    }

    /** 흰색 글자에 검정색 테두리 텍스트 렌더링 헬퍼 */
    _drawT(ctx, text, x, y, options = {}) {
        const {
            font = 'bold 12px Inter, sans-serif',
            align = 'center',
            baseline = 'middle',
            fill = '#ffffff',
            stroke = '#000000',
            strokeW = 3
        } = options;
        ctx.save();
        ctx.font = font;
        ctx.textAlign = align;
        ctx.textBaseline = baseline;
        
        ctx.strokeStyle = stroke;
        ctx.lineWidth = strokeW;
        ctx.lineJoin = 'round';
        ctx.strokeText(text, x, y);
        
        ctx.fillStyle = fill;
        ctx.fillText(text, x, y);
        ctx.restore();
    }

    /** 주어진 local Y 높이에서 블록 배면(오른쪽) 폭 반환 */
    _getBackWidthAtY(bp, localY) {
        if (localY >= bp.cap.bottom && localY <= bp.cap.top) return bp.cap.w;
        for (const blk of bp.blocks) {
            if (localY >= blk.bottom && localY <= blk.top) return blk.w;
        }
        return bp.maxW;
    }

    draw(data) {
        this._lastData = data;
        const ctx = this.ctx;
        const W = this.canvas.width, H = this.canvas.height;
        ctx.clearRect(0, 0, W, H);

        const bp = this._calculateBlockPositions(data);
        this.originX = W * 0.30;
        this.originY = H * 0.88; // 기준점 위치 (구조물 중앙 배치)

        this._drawBackground(data, bp);
        this._drawRubble(data, bp);
        this._drawBlocks(data, bp);
        if (this.showWaterLevels) this._drawWaterLevels(data, bp);

        if (this.showForces) this._drawForces(data, bp);
        if (this.showCL) this._drawCL(data, bp);

        const blockBottomDL = data.seabedEL + data.rubbleHeight;
        if (this.showDimensions) this._drawDimensions(data, bp, blockBottomDL);
        if (this.showLabels) this._drawLabels(data, bp);
    }

    _calculateBlockPositions(data) {
        const blocks = [];
        let maxW = 0;

        // 기준: data.seabedEL + data.rubbleHeight 가 localY = 0 의 기준점
        const baseDL = data.seabedEL + data.rubbleHeight;

        // DL을 localY로 변환
        const toLocalY = (dl) => dl - baseDL;

        let prevBotEL = data.crownEL;

        // Cap Block
        const capTopY = toLocalY(data.crownEL);
        const capBotY = toLocalY(data.cap.bottomEL);
        const capH = Math.max(0, capTopY - capBotY); // 음수 방지
        const cap = { x: 0, bottom: capBotY, top: capBotY + capH, w: data.cap.width, h: capH };
        if (data.cap.width > maxW) maxW = data.cap.width;

        prevBotEL = data.cap.bottomEL;

        // blocks (입력은 최상단[0] ~ 최하단[n-1] 순서)
        for (let i = 0; i < data.blocks.length; i++) {
            const b = data.blocks[i];
            const topY = toLocalY(prevBotEL);
            const botY = toLocalY(b.bottomEL);
            const h = Math.max(0, topY - botY); // 음수 방지

            // 역순(최하단이 0번 인덱스)으로 blocks 배열에 추가
            blocks.unshift({ x: 0, bottom: botY, top: botY + h, w: b.width, h: h });
            if (b.width > maxW) maxW = b.width;

            prevBotEL = b.bottomEL;
        }

        return { blocks, cap, maxW };
    }

    // ────────────────────────────────────────
    // 배경 (매립토 완전 채움)
    // ────────────────────────────────────────
    _drawBackground(data, bp) {
        const ctx = this.ctx;
        const W = this.canvas.width, H = this.canvas.height;

        const waterSurfaceY = this.wy(data.ahhwY);
        const wallFrontX = this.wx(0);
        ctx.fillStyle = 'rgba(40,120,180,0.18)';
        ctx.fillRect(0, waterSurfaceY, wallFrontX, H - waterSurfaceY);

        const seabedLocalY = -(data.rubbleHeight);
        const seabedCanvasY = this.wy(seabedLocalY);
        ctx.fillStyle = '#8d7b5a';
        ctx.fillRect(0, seabedCanvasY, W, H - seabedCanvasY);

        // 매립토: 전체 배경 (캔버스 우측 중심토사)
        const rubH = data.rubbleHeight;
        const yTop = bp.cap.top;
        const ySeabed = -rubH;

        ctx.fillStyle = '#c4a566';
        ctx.beginPath();
        ctx.moveTo(this.wx(0), this.wy(yTop));
        ctx.lineTo(W, this.wy(yTop));
        ctx.lineTo(W, this.wy(ySeabed));
        ctx.lineTo(this.wx(0), this.wy(ySeabed));
        ctx.closePath();
        ctx.fill();

        // 5D 시각화 레이어 (뒷채움, 포장 등)
        const H_pave = 0.2;
        const H_sub = 0.3;
        const yBackfillTop = yTop - (H_pave + H_sub);
        const hDrop = yBackfillTop - ySeabed;

        // 필터 사석 (Filter Stone, 상단폭 0.5m, 1:1.2 기울기)
        ctx.fillStyle = '#a8b4be'; // 약간 밝고 단단한 회색
        ctx.beginPath();
        ctx.moveTo(this.wx(bp.maxW), this.wy(yBackfillTop));
        ctx.lineTo(this.wx(bp.maxW + 0.5), this.wy(yBackfillTop));
        ctx.lineTo(this.wx(bp.maxW + 0.5 + hDrop * 1.2), this.wy(ySeabed));
        ctx.lineTo(this.wx(bp.maxW + hDrop * 1.0), this.wy(ySeabed));
        ctx.closePath();
        ctx.fill();

        // 필터 매트/사석 경계선 (Filter Mat)
        ctx.strokeStyle = '#e67e22'; // 주황색 점선
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(this.wx(bp.maxW + 0.5), this.wy(yBackfillTop));
        ctx.lineTo(this.wx(bp.maxW + 0.5 + hDrop * 1.2), this.wy(ySeabed));
        ctx.stroke();
        ctx.setLineDash([]); // 점선 복구

        // 뒤채움 사석 (Rubble Backfill, 가상배면 MaxW에서 1:1 기울기)
        ctx.fillStyle = '#78909c'; // 청회색
        ctx.beginPath();
        ctx.moveTo(this.wx(0), this.wy(yBackfillTop));
        ctx.lineTo(this.wx(bp.maxW), this.wy(yBackfillTop));
        ctx.lineTo(this.wx(bp.maxW + hDrop * 1.0), this.wy(ySeabed));
        ctx.lineTo(this.wx(0), this.wy(ySeabed));
        ctx.closePath();
        ctx.fill();

        // 보조기층 (Subbase, 0.3m)
        ctx.fillStyle = '#8d6e63'; // 짙은 흙색(갈색)
        ctx.beginPath();
        ctx.moveTo(this.wx(bp.cap.w), this.wy(yTop - H_pave));
        ctx.lineTo(W, this.wy(yTop - H_pave));
        ctx.lineTo(W, this.wy(yBackfillTop));
        ctx.lineTo(this.wx(bp.cap.w), this.wy(yBackfillTop));
        ctx.closePath();
        ctx.fill();

        // 콘크리트 포장 (Pavement, 0.2m)
        ctx.fillStyle = '#cfd8dc'; // 밝은 콘크리트 회색
        ctx.beginPath();
        ctx.moveTo(this.wx(bp.cap.w), this.wy(yTop));
        ctx.lineTo(W, this.wy(yTop));
        ctx.lineTo(W, this.wy(yTop - H_pave));
        ctx.lineTo(this.wx(bp.cap.w), this.wy(yTop - H_pave));
        ctx.closePath();
        ctx.fill();


        // ─────────────────────────────────────────────────────────────────
        // ── 콘크리트 포장 및 보조기층 상세 라벨 (CAD 표준 Grouped Leaders) ──
        // ─────────────────────────────────────────────────────────────────
        const xStartLabel = bp.cap.w + 1.5;
        const detailX = this.wx(xStartLabel);
        const lineEndX = detailX + 150;  // 수직선 및 지시선의 꺾임 지점
        const yPaveTop = this.wy(yTop);
        const yPaveBot = this.wy(yTop - H_pave);
        const ySubBot = this.wy(yTop - H_pave - H_sub);

        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1;

        // 1. 콘크리트 포장 (상단)
        const line1Y = yPaveTop - 60;
        if (this.showLabels && this.showLabelPave) {
            ctx.beginPath();
            ctx.moveTo(detailX, line1Y); ctx.lineTo(lineEndX, line1Y);
            ctx.lineTo(lineEndX, yPaveTop);
            ctx.stroke();
            this._drawArrow(ctx, lineEndX, yPaveTop, 'down', '#ffffff');
            this._drawT(ctx, '콘크리트 포장 ( t = 20cm )', detailX + 5, line1Y - 4, { align: 'left', baseline: 'bottom' });
        }

        // 2. 보조기층 (하단)
        const line2Y = yPaveTop - 30;
        if (this.showLabels && this.showLabelSub) {
            ctx.beginPath();
            ctx.moveTo(detailX, line2Y); ctx.lineTo(lineEndX, line2Y);
            ctx.lineTo(lineEndX, yPaveBot);
            ctx.stroke();
            this._drawArrow(ctx, lineEndX, yPaveBot, 'down', '#ffffff');
            this._drawT(ctx, '보조기층 ( t = 30cm )', detailX + 5, line2Y - 4, { align: 'left', baseline: 'bottom' });
        }


        // ── 구역 내부 라벨 (뒤채움사석, 필터사석) ──
        const centerBackfillX = this.wx(bp.maxW + (hDrop * 1.0) / 3);
        const centerBackfillY = this.wy(ySeabed + hDrop * 0.4);

        if (this.showLabels && this.showLabelBackfill) {
            this._drawT(ctx, '뒤채움사석', centerBackfillX, centerBackfillY - 8, { font: 'bold 12px Inter, sans-serif' });
            this._drawT(ctx, '( 0.001 ~ 0.03m³/ea )', centerBackfillX, centerBackfillY + 8, { font: '400 10.5px Inter, sans-serif' });
        }

        const filterX = this.wx(bp.maxW + 0.5 + (hDrop * 1.2) * 0.65);
        const filterY = this.wy(ySeabed + hDrop * 0.25);
        
        const fKinkX = filterX + 40, fKinkY = filterY + 40;
        if (this.showLabels && this.showLabelFilter) {
            ctx.beginPath();
            ctx.moveTo(fKinkX + 160, fKinkY);
            ctx.lineTo(fKinkX, fKinkY);
            ctx.lineTo(filterX, filterY);
            ctx.stroke();

            ctx.save();
            ctx.translate(filterX, filterY);
            ctx.rotate(-Math.PI * 0.75);
            ctx.fillStyle = '#ffffff';
            ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(-10, -4); ctx.lineTo(-10, 4); ctx.closePath(); ctx.fill();
            ctx.restore();
            this._drawT(ctx, '필터사석 ( Φ 100mm 이하 )', fKinkX + 5, fKinkY - 4, { align: 'left', baseline: 'bottom' });
        }

        if (this.showLabels && this.showLabelFill) {
            this._drawT(ctx, '매  립', this.wx(bp.maxW + 15), this.wy(ySeabed + hDrop / 2), { font: 'bold 16px Inter, sans-serif', fill: 'rgba(255,255,255,0.5)' });
        }
    }

    // ────────────────────────────────────────
    // 기초사석 (FIX #5: 전면 1:1.5, 배면 1:1)
    // ────────────────────────────────────────
    _drawRubble(data, bp) {
        const ctx = this.ctx;
        const rubH = data.rubbleHeight;
        const seaW = data.rubbleWidth;    // 해측 돌출폭
        const landW = 1.0;               // 배면 돌출폭 (고정)
        const slopeF = 1.5;              // 전면 경사 1:1.5
        const slopeB = 1.0;              // 배면 경사 1:1

        const leftTop = -seaW;
        const rightTop = bp.maxW + landW;

        // 1. 기초사석 본체
        ctx.fillStyle = '#9a8b6e';
        ctx.strokeStyle = '#7a6b4e';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(this.wx(leftTop), this.wy(0));
        ctx.lineTo(this.wx(rightTop), this.wy(0));
        ctx.lineTo(this.wx(rightTop + rubH * slopeB), this.wy(-rubH));   // 배면 1:1
        ctx.lineTo(this.wx(leftTop - rubH * slopeF), this.wy(-rubH));    // 전면 1:1.5
        ctx.closePath();
        ctx.fill(); ctx.stroke();

        // 2. 사석 내부 해칭 (전체 대각선 무늬)
        // [최적화: 가시 영역만 계산하여 루프 횟수 대폭 감소]
        ctx.save();
        ctx.clip();
        ctx.strokeStyle = 'rgba(255,255,255,0.12)';
        ctx.lineWidth = 0.8;
        const hSpacing = 0.45;
        const hatchMinX = leftTop - rubH * slopeF - 2;
        const hatchMaxX = rightTop + rubH * slopeB + 12;
        ctx.beginPath();
        for (let x = hatchMinX; x < hatchMaxX; x += hSpacing) {
            ctx.moveTo(this.wx(x), this.wy(2));
            ctx.lineTo(this.wx(x + 10), this.wy(-rubH - 2));
        }
        ctx.stroke();
        ctx.restore();

        // 3. 기초사석 라벨 및 지시선 (이미지 스타일 준수하되 구조물 오해 방지)
        const rubCenterX = (leftTop + rightTop) / 2;
        const rubCenterY = -rubH / 2;
        const canX = this.wx(rubCenterX);
        const canY = this.wy(rubCenterY);

        if (this.showLabels && this.showLabelFoundation) {
            // 글자 배경 강조 (박스 없이 그림자/테두리 효과만)
            this._drawT(ctx, '기  초  사  석', canX, canY - 10, { font: '700 13.5px "Inter", sans-serif', strokeW: 4 });
            this._drawT(ctx, '( 0.015 ~ 0.03 m³/ea )', canX, canY + 12, { font: '500 11px "Inter", sans-serif', strokeW: 3 });
        }

        if (this.showLabels && this.showLabelFoundation) {
            const arrowY = canY + 1;
            const textGap = 55;
            const arrowLen = 35;
            ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.2;

            ctx.beginPath(); ctx.moveTo(canX - textGap, arrowY); ctx.lineTo(canX - textGap - arrowLen, arrowY); ctx.stroke();
            this._drawArrow(ctx, canX - textGap - arrowLen, arrowY, 'left', '#ffffff');

            ctx.beginPath(); ctx.moveTo(canX + textGap, arrowY); ctx.lineTo(canX + textGap + arrowLen, arrowY); ctx.stroke();
            this._drawArrow(ctx, canX + textGap + arrowLen, arrowY, 'right', '#ffffff');
        }

        // 4. 해측 피복석 (Armor Stone)
        const armH = data.armorHeight || 0.6;
        const armHW = armH * slopeF;

        ctx.fillStyle = '#607d8b';
        ctx.strokeStyle = '#455a64';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(this.wx(0), this.wy(0));
        ctx.lineTo(this.wx(0), this.wy(armH));
        ctx.lineTo(this.wx(leftTop), this.wy(armH));
        ctx.lineTo(this.wx(leftTop - rubH * slopeF - armHW), this.wy(-rubH));
        ctx.lineTo(this.wx(leftTop - rubH * slopeF), this.wy(-rubH));
        ctx.lineTo(this.wx(leftTop), this.wy(0));
        ctx.closePath();
        ctx.fill(); ctx.stroke();

        if (this.showLabels && this.showLabelArmor) {
            // 위치 조정: 겹침 방지를 위해 해측으로 조금 더 이동 (leftTop * 0.65)
            this._drawT(ctx, '해측 사면부', this.wx(leftTop * 0.65), this.wy(armH * 0.5));
        }
    }

    // ────────────────────────────────────────
    // 블록
    // ────────────────────────────────────────
    _drawBlocks(data, bp) {
        const ctx = this.ctx;
        const toe = data.toe || { width: 0, armorHeight: 0, slopeHeight: 0 };

        for (let i = bp.blocks.length - 1; i >= 0; i--) {
            const blk = bp.blocks[i];
            const colorSet = this.blockColors[i % this.blockColors.length];
            ctx.fillStyle = colorSet.fill;
            ctx.strokeStyle = colorSet.stroke;
            ctx.lineWidth = 2;

            const isBottom = (i === 0);

            if (isBottom && toe.width > 0) {
                const toeW = toe.width;
                const armH = toe.armorHeight; // 피복석 높이만큼 수직 (Segment 1)
                const slopeH = toeW;          // 45도 기울기 (Segment 2: dy=dx=toeW)

                const blockTop = blk.top, blockBot = blk.bottom;
                const blockRight = blk.x + blk.w, blockLeft = blk.x;
                const toeLeft = blockLeft - toeW;

                const v1Y = blockBot + armH;       // 1차 꺾임점 (수직-사경 경계)
                const v2Y = blockBot + armH + slopeH; // 2차 꺾임점 (사경-수직 경계)

                ctx.beginPath();
                ctx.moveTo(this.wx(blockLeft), this.wy(blockTop));
                ctx.lineTo(this.wx(blockRight), this.wy(blockTop));
                ctx.lineTo(this.wx(blockRight), this.wy(blockBot));
                ctx.lineTo(this.wx(toeLeft), this.wy(blockBot));
                ctx.lineTo(this.wx(toeLeft), this.wy(v1Y));   // 하단 수직부
                ctx.lineTo(this.wx(blockLeft), this.wy(v2Y)); // 45도 사경부
                ctx.lineTo(this.wx(blockLeft), this.wy(blockTop)); // 상단 수직부
                ctx.closePath();
                ctx.fill(); ctx.stroke();
            } else {
                const x = this.wx(blk.x), y = this.wy(blk.top);
                const w = blk.w * this.scale, h = blk.h * this.scale;
                ctx.fillRect(x, y, w, h);
                ctx.strokeRect(x, y, w, h);
            }
        }

        // 상치 콘크리트
        const cap = bp.cap;
        ctx.fillStyle = this.colors.cap;
        ctx.strokeStyle = this.colors.capStroke;
        ctx.lineWidth = 2;
        ctx.fillRect(this.wx(cap.x), this.wy(cap.top), cap.w * this.scale, cap.h * this.scale);
        ctx.strokeRect(this.wx(cap.x), this.wy(cap.top), cap.w * this.scale, cap.h * this.scale);
    }

    // ────────────────────────────────────────
    // 조위 (FIX #1: DL은 조위 오른쪽, FIX #4: RWL 블록 배면에서)
    // ────────────────────────────────────────
    _drawWaterLevels(data, bp) {
        const ctx = this.ctx;
        const wallFrontX = this.wx(0);
        const blockBottomDL = data.seabedEL + data.rubbleHeight;

        const ahhwCanv = this.wy(data.ahhwY);
        const mtlCanv = this.wy(data.mtlY);
        const allwCanv = this.wy(data.allwY);

        const ahhwDL = data.ahhwY + blockBottomDL;
        const mtlDL = data.mtlY + blockBottomDL;
        const allwDL = data.allwY + blockBottomDL;

        ctx.save();
        ctx.setLineDash([6, 4]); ctx.lineWidth = 1.5;
        ctx.font = '600 11px Inter, Noto Sans KR, sans-serif';
        ctx.textAlign = 'left';

        // HHW
        ctx.strokeStyle = '#e57373'; ctx.fillStyle = '#e57373';
        ctx.beginPath(); ctx.moveTo(0, ahhwCanv); ctx.lineTo(wallFrontX, ahhwCanv); ctx.stroke();
        // 조위 표시 (H.H.W, L.L.W, M.T.L)
        ctx.fillStyle = 'rgba(0, 162, 255, 0.9)';
        ctx.font = 'bold 11px Inter, sans-serif';

        ctx.fillText(`App. HHW (약최고고조위) DL${this._dlSign(ahhwDL)}${Math.abs(ahhwDL).toFixed(3)}m`, 10, ahhwCanv - 8);
        ctx.fillText(`App. LLW (약최저저조위) DL${this._dlSign(allwDL)}${Math.abs(allwDL).toFixed(3)}m`, 10, allwCanv - 8);

        ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.fillText(`M.T.L (평균해수면) DL${this._dlSign(mtlDL)}${Math.abs(mtlDL).toFixed(3)}m`, 10, mtlCanv - 8);

        // LLW
        ctx.strokeStyle = '#4dd0e1'; ctx.fillStyle = '#4dd0e1';
        ctx.beginPath(); ctx.moveTo(0, allwCanv); ctx.lineTo(wallFrontX, allwCanv); ctx.stroke();

        // MTL
        ctx.strokeStyle = '#64b5f6'; ctx.fillStyle = '#64b5f6';
        ctx.beginPath(); ctx.moveTo(0, mtlCanv); ctx.lineTo(wallFrontX, mtlCanv); ctx.stroke();

        // ── 잔류수위 (RWL) ──
        // FIX #4: 블록과 매립토가 만나는 지점(블록 배면)에서 시작
        const rh = data.residualHead || 0;
        if (rh > 0) {
            const rwlLocalY = data.allwY + rh;
            const rwlCanv = this.wy(rwlLocalY);
            const rwlDL = rwlLocalY + blockBottomDL;

            // 블록 배면 폭: RWL 높이에서의 실제 블록 폭
            const backW = this._getBackWidthAtY(bp, rwlLocalY);
            const blockBackX = this.wx(backW);

            ctx.strokeStyle = '#e07040'; ctx.fillStyle = '#e07040';
            ctx.setLineDash([8, 4]); ctx.lineWidth = 1.5;

            // 블록 배면(블록과 매립토 만나는 지점)에서 MTL쪽으로 경사
            ctx.beginPath();
            ctx.moveTo(wallFrontX, mtlCanv);
            ctx.lineTo(blockBackX, rwlCanv);
            ctx.stroke();

            // 배면에서 수평 연장
            ctx.beginPath();
            ctx.moveTo(blockBackX, rwlCanv);
            ctx.lineTo(this.canvas.width, rwlCanv);
            ctx.stroke();

            ctx.setLineDash([]);
            const rwlRise = rh.toFixed(3);
            const labelText = `잔류수위 (RWL Rise: ${rwlRise}m) DL${this._dlSign(rwlDL)}${Math.abs(rwlDL).toFixed(3)}m`;
            const labelOffsetX = 120; // 텍스트를 오른쪽으로 띄움
            this._drawT(ctx, labelText, blockBackX + 14 + labelOffsetX, rwlCanv - 9, { align: 'left', font: '600 11px Inter, sans-serif' });
        }

        ctx.restore();
    }

    // ════════════════════════════════════════════════
    // 외력 분포도 (※ 개념도이며, 최종 판정은 수치 계산 결과를 따름)
    // ════════════════════════════════════════════════
    _drawForces(data, bp) {
        const ctx = this.ctx;
        ctx.save();

        this._drawT(ctx, "※ 외력분포도는 개념도이며, 최종 판정은 수치 계산 결과를 따릅니다.", this.canvas.width - 20, 25, { 
            align: 'right', fill: '#fbbf24', font: 'italic 500 11px Inter, sans-serif' 
        });

        const wallFrontX = this.wx(0);
        const wallBotY = this.wy(0);
        const wallTopY = this.wy(bp.cap.top);
        const wallH = wallBotY - wallTopY;

        const totalDimX = this.wx(Math.max(bp.cap.w, bp.maxW) + 1.8);
        const gap = 30;
        let curX = totalDimX + gap;

        // ── 1. 배면 토압 (Pa) ── 삼각형
        const eaW = wallH * 0.22;
        ctx.fillStyle = 'rgba(210, 105, 30, 0.25)';
        ctx.strokeStyle = '#d2691e'; ctx.lineWidth = 2; ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(curX, wallTopY);
        ctx.lineTo(curX + eaW, wallBotY);
        ctx.lineTo(curX, wallBotY);
        ctx.closePath();
        ctx.fill(); ctx.stroke();

        for (let j = 1; j <= 4; j++) {
            const r = j / 4;
            const ay = wallTopY + wallH * r;
            ctx.strokeStyle = '#d2691e'; ctx.lineWidth = 1.5; ctx.setLineDash([]);
            ctx.beginPath(); ctx.moveTo(curX + eaW * r, ay); ctx.lineTo(curX, ay); ctx.stroke();
            this._drawArrow(ctx, curX, ay, 'left', '#d2691e');
        }
        ctx.font = 'bold 10px Inter'; ctx.fillStyle = '#d2691e'; ctx.textAlign = 'center';
        ctx.fillText('Pa (토압)', curX + eaW * 0.5, wallTopY - 10);
        curX += eaW + gap;

        // ── 2. 상재하중 (Pq) ── 등분
        const q1 = data.surchargeStructure || 0;
        const q2 = data.surchargeHinterland || 0;
        if (q1 + q2 > 0) {
            const qW = wallH * 0.10;
            ctx.fillStyle = 'rgba(0, 200, 120, 0.25)';
            ctx.strokeStyle = '#00c878'; ctx.lineWidth = 1.5; ctx.setLineDash([]);
            ctx.fillRect(curX, wallTopY, qW, wallH);
            ctx.strokeRect(curX, wallTopY, qW, wallH);

            for (let j = 1; j <= 4; j++) {
                const r = j / 4;
                const ay = wallTopY + wallH * r;
                ctx.strokeStyle = '#00c878'; ctx.lineWidth = 1;
                ctx.beginPath(); ctx.moveTo(curX + qW, ay); ctx.lineTo(curX, ay); ctx.stroke();
                this._drawArrow(ctx, curX, ay, 'left', '#00c878');
            }
            ctx.font = 'bold 10px Inter'; ctx.fillStyle = '#00c878'; ctx.textAlign = 'center';
            ctx.fillText('Pq (상재)', curX + qW / 2, wallTopY - 10);
            curX += qW + gap;
        }

        // ── 3. 잔류수압 (Prw) ── 복합분포
        const rh = data.residualHead || 0;
        if (rh > 0) {
            const rwlLocalY = data.allwY + rh;  // 기존 mtlY + rh 에서 교정
            const rwlCanv = this.wy(rwlLocalY);
            let allwCanv = this.wy(data.allwY);   // DL 0.00m

            // 잔류수압 영향은 블록 하단(wallBotY)까지만!
            // 캔버스 y 좌표계는 아래로 갈수록 값이 크므로, wallBotY보다 크면 clamp
            if (rwlCanv < wallBotY) {
                let actualAllwCanv = allwCanv;
                let maxW = wallH * 0.12;
                let botW = maxW;

                if (allwCanv > wallBotY) {
                    actualAllwCanv = wallBotY;
                    botW = maxW * ((wallBotY - rwlCanv) / (allwCanv - rwlCanv));
                }

                ctx.fillStyle = 'rgba(100, 180, 240, 0.22)';
                ctx.strokeStyle = '#42a5f5'; ctx.lineWidth = 1.5; ctx.setLineDash([]);

                // 상부 삼각형 (RWL에서 LLW 또는 블록하단까지)
                ctx.beginPath();
                ctx.moveTo(curX, rwlCanv);
                ctx.lineTo(curX + botW, actualAllwCanv);
                ctx.lineTo(curX, actualAllwCanv);
                ctx.closePath();
                ctx.fill(); ctx.stroke();

                // 하부 직사각형 (LLW에서 블록하단까지)
                if (allwCanv <= wallBotY) {
                    const rectH = wallBotY - actualAllwCanv;
                    if (rectH > 5) {
                        ctx.fillRect(curX, actualAllwCanv, maxW, rectH);
                        ctx.strokeRect(curX, actualAllwCanv, maxW, rectH);
                    }

                    // 직사각형부 화살표
                    if (rectH > 20) {
                        for (let j = 1; j <= 2; j++) {
                            const r = j / 2;
                            const ay = actualAllwCanv + rectH * r;
                            ctx.strokeStyle = '#42a5f5'; ctx.lineWidth = 1;
                            ctx.beginPath(); ctx.moveTo(curX + maxW, ay); ctx.lineTo(curX, ay); ctx.stroke();
                            this._drawArrow(ctx, curX, ay, 'left', '#42a5f5');
                        }
                    }
                }

                // 삼각형부 화살표
                const triH = actualAllwCanv - rwlCanv;
                if (triH > 10) {
                    for (let j = 1; j <= 2; j++) {
                        const r = j / 2;
                        const ay = rwlCanv + triH * r;
                        const aw = botW * r;
                        ctx.strokeStyle = '#42a5f5'; ctx.lineWidth = 1;
                        ctx.beginPath(); ctx.moveTo(curX + aw, ay); ctx.lineTo(curX, ay); ctx.stroke();
                        this._drawArrow(ctx, curX, ay, 'left', '#42a5f5');
                    }
                }

                ctx.font = 'bold 10px Inter'; ctx.fillStyle = '#42a5f5'; ctx.textAlign = 'center';
                ctx.fillText('Prw (잔류수압)', curX + maxW / 2, rwlCanv - 10);
                curX += maxW + gap;
            }
        }

        // ── 4. 관성력 (Fi) ── 계단형 (상단→하단)
        const kh = data.seismicKh || 0;
        if (kh > 0) {
            const maxBlockW = bp.maxW;
            const fiMaxW = wallH * 0.18;

            const topToBot = [];
            topToBot.push(bp.cap);
            for (let k = bp.blocks.length - 1; k >= 0; k--) {
                topToBot.push(bp.blocks[k]);
            }

            ctx.fillStyle = 'rgba(255, 112, 67, 0.20)';
            ctx.strokeStyle = '#ff7043'; ctx.lineWidth = 1.5; ctx.setLineDash([]);

            ctx.beginPath();
            ctx.moveTo(curX, wallTopY);
            for (let k = 0; k < topToBot.length; k++) {
                const elem = topToBot[k];
                const ratio = elem.w / maxBlockW;
                const pw = fiMaxW * ratio;
                ctx.lineTo(curX + pw, this.wy(elem.top));
                ctx.lineTo(curX + pw, this.wy(elem.bottom));
            }
            ctx.lineTo(curX, wallBotY);
            ctx.closePath();
            ctx.fill(); ctx.stroke();

            for (let k = 0; k < topToBot.length; k++) {
                const elem = topToBot[k];
                const ratio = elem.w / maxBlockW;
                const pw = fiMaxW * ratio;
                const midY = this.wy((elem.top + elem.bottom) / 2);
                ctx.strokeStyle = '#ff7043'; ctx.lineWidth = 1;
                ctx.beginPath(); ctx.moveTo(curX + pw, midY); ctx.lineTo(curX, midY); ctx.stroke();
                this._drawArrow(ctx, curX, midY, 'left', '#ff7043');
            }
            ctx.font = 'bold 10px Inter'; ctx.fillStyle = '#ff7043'; ctx.textAlign = 'center';
            ctx.fillText('Fi (관성력)', curX + fiMaxW / 2, wallTopY - 10);
            curX += fiMaxW + gap;
        }

        // ── 5. 견인력 (Pb)
        const bf = data.bollardForce || 0;
        if (bf > 0) {
            const bfLen = 45;
            ctx.strokeStyle = '#ab47bc'; ctx.fillStyle = '#ab47bc';
            ctx.lineWidth = 2.5; ctx.setLineDash([]);
            ctx.beginPath();
            ctx.moveTo(curX + bfLen, wallTopY + 5);
            ctx.lineTo(curX, wallTopY + 5);
            ctx.stroke();
            this._drawArrow(ctx, curX, wallTopY + 5, 'left', '#ab47bc');
            ctx.font = 'bold 10px Inter'; ctx.textAlign = 'center';
            ctx.fillText('Pb (견인력)', curX + bfLen / 2, wallTopY - 10);
        }

        // ════════════════════════════════════
        // 해측 외력
        // ════════════════════════════════════
        const toe = data.toe || { width: 0 };
        const toeLeft = toe.width > 0 ? -toe.width : 0;
        let seaX = this.wx(toeLeft) - 25;

        // ── 6. 파압 (Pw) ── Goda
        const H_D = data.waveHeight || 2.0;
        const beta = (data.waveAngle || 0) * Math.PI / 180;
        const dwlLocal = data.ahhwY;
        const etaStar = 0.75 * (1 + Math.cos(beta)) * H_D;
        const etaStarLocal = dwlLocal + etaStar;
        const seabedLocal = -(data.rubbleHeight);
        const h_depth = dwlLocal - seabedLocal;
        const T = data.wavePeriod || 8.0;
        const L0 = 9.81 * T * T / (2 * Math.PI);
        const kh2 = 2 * Math.PI * h_depth / L0;
        const alpha3 = Math.max(0.3, 1 - (1 - 1 / Math.cosh(kh2)));

        const etaStarCY = this.wy(etaStarLocal);
        const dwlCY = this.wy(dwlLocal);
        const seabedCY = this.wy(seabedLocal);
        const p1W = wallH * 0.20;
        const p3W = p1W * alpha3;

        ctx.fillStyle = 'rgba(25, 100, 200, 0.15)';
        ctx.strokeStyle = '#1565c0'; ctx.lineWidth = 2; ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(seaX, etaStarCY);
        ctx.lineTo(seaX - p1W, dwlCY);
        ctx.lineTo(seaX - p3W, seabedCY);
        ctx.lineTo(seaX, seabedCY);
        ctx.closePath();
        ctx.fill(); ctx.stroke();

        const totalPH = seabedCY - etaStarCY;
        for (let j = 1; j <= 5; j++) {
            const r = j / 5;
            const ay = etaStarCY + totalPH * r;
            const dwlR = (dwlCY - etaStarCY) / totalPH;
            let aw;
            if (r <= dwlR) { aw = (r / dwlR) * p1W; }
            else { aw = p1W - (p1W - p3W) * ((r - dwlR) / (1 - dwlR)); }
            ctx.strokeStyle = '#1565c0'; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(seaX - aw, ay); ctx.lineTo(seaX, ay); ctx.stroke();
            this._drawArrow(ctx, seaX, ay, 'right', '#1565c0');
        }
        ctx.font = 'bold 10px Inter'; ctx.fillStyle = '#1565c0'; ctx.textAlign = 'center';
        ctx.fillText('Pw (파압)', seaX - p1W * 0.5, etaStarCY - 10);

        seaX -= Math.max(p1W, p3W) + gap + 15;

        // ── 7. 동수압 (Pdw) ── 포물선
        if (kh > 0) {
            const hw = Math.max(0, data.ahhwY);
            if (hw > 0) {
                const hwTop = this.wy(data.ahhwY);
                const dwW = wallH * 0.12;

                ctx.fillStyle = 'rgba(200, 60, 60, 0.12)';
                ctx.strokeStyle = '#e53935'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);

                ctx.beginPath();
                ctx.moveTo(seaX, hwTop);
                const steps = 20;
                for (let s = 0; s <= steps; s++) {
                    const r = s / steps;
                    const y = hwTop + (wallBotY - hwTop) * r;
                    const pw = dwW * Math.sqrt(r);
                    ctx.lineTo(seaX - pw, y);
                }
                ctx.lineTo(seaX, wallBotY);
                ctx.closePath();
                ctx.fill(); ctx.stroke();
                ctx.setLineDash([]);

                for (let j = 1; j <= 3; j++) {
                    const r = j / 3;
                    const ay = hwTop + (wallBotY - hwTop) * r;
                    const pw = dwW * Math.sqrt(r);
                    ctx.strokeStyle = '#e53935'; ctx.lineWidth = 1;
                    ctx.beginPath(); ctx.moveTo(seaX - pw, ay); ctx.lineTo(seaX, ay); ctx.stroke();
                    this._drawArrow(ctx, seaX, ay, 'right', '#e53935');
                }
                ctx.font = 'bold 10px Inter'; ctx.fillStyle = '#e53935'; ctx.textAlign = 'center';
                ctx.fillText('Pdw (동수압)', seaX - dwW * 0.5, hwTop - 10);
            }
        }

        // ── 가상배면 (Virtual Back Plane) ──
        ctx.strokeStyle = '#f97316'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(this.wx(bp.maxW), this.wy(bp.cap.top + 0.3));
        ctx.lineTo(this.wx(bp.maxW), this.wy(-data.rubbleHeight));
        ctx.stroke();
        ctx.setLineDash([]);
        this._drawT(ctx, '가상배면', this.wx(bp.maxW), this.wy(bp.cap.top + 0.5), { font: '600 12px "Noto Sans KR", Inter, sans-serif', fill: '#f97316' });

        ctx.restore();
    }

    // ────────────────────────────────────────
    // 치수선 (FIX #1: DL은 조위 오른쪽, FIX #3: Toe 글자 제거)
    // ────────────────────────────────────────
    _drawDimensions(data, bp, blockBottomDL) {
        const ctx = this.ctx;
        const color = this.colors.dimLines;
        ctx.save();

        const slopeColor = '#ffffff'; // 흰색 치수선
        // 세로 치수 (검정색 치수선)
        this._drawVertDim(ctx, bp.cap.w + 0.3, bp.cap.bottom, bp.cap.top, `${bp.cap.h.toFixed(1)}m`, slopeColor);
        bp.blocks.forEach(blk => {
            this._drawVertDim(ctx, blk.w + 0.3, blk.bottom, blk.top, `${blk.h.toFixed(1)}m`, slopeColor);
        });

        // 가로 치수 (검정색 치수선)
        const toe = data.toe || { width: 0, armorHeight: 0, slopeHeight: 0 };
        this._drawHorizDim(ctx, 0, bp.cap.w, bp.cap.bottom + 0.2, `B=${bp.cap.w.toFixed(1)}m`, slopeColor);
        bp.blocks.forEach((blk, idx) => {
            const isBottom = (idx === 0);
            if (isBottom && toe.width > 0) {
                const totalW = blk.w + toe.width;
                this._drawHorizDim(ctx, -toe.width, blk.w, blk.bottom + 0.2, `B=${totalW.toFixed(1)}m`, slopeColor);
            } else {
                this._drawHorizDim(ctx, 0, blk.w, blk.bottom + 0.2, `B=${blk.w.toFixed(1)}m`, slopeColor);
            }
        });

        // ── 법면 경사도 (Slope) 표시 (CAD 스타일 1:N) ──
        const slColor = '#ffffff';
        const rubH = data.rubbleHeight;
        const H_pave = 0.2, H_sub = 0.3;
        const yTop = bp.cap.top;
        const yBackfillTop = yTop - (H_pave + H_sub);
        const ySeabed = -rubH;
        const hDrop = yBackfillTop - ySeabed;

        // 기초사석 배면 (1:1)
        this._drawSlope(ctx, bp.maxW + 1.0 + (rubH * 1.0) / 2, -rubH / 2, 1, 1, slColor, 'right');
        // 뒤채움사석 (1:1)
        this._drawSlope(ctx, bp.maxW + (hDrop * 1.0) / 2, ySeabed + hDrop / 2, 1, 1, slColor, 'right');
        // 필터사석 (1:1.2)
        this._drawSlope(ctx, bp.maxW + 0.5 + (hDrop * 1.2) / 2, ySeabed + hDrop / 2, 1, 1.2, slColor, 'right');
        // 해측 피복석 (1:1.5) - 복구
        this._drawSlope(ctx, -data.rubbleWidth - (rubH * 1.5) / 2, -rubH / 3, 1, 1.5, slColor, 'left');

        // ── DL 표고: 동수압(Pdw) 분포도와 조위 텍스트 사이에 배치 ──
        // 조위 텍스트는 x=10~500, Pdw는 블록 왼쪽 바로 옆
        // 그 중간 = 약 wallFrontX 기준 -180px
        const dlBaseX = this.wx(0) - 180;

        const drawDL = (dlLevel) => {
            const locY = dlLevel - blockBottomDL;
            const yCanv = this.wy(locY);

            const sign = this._dlSign(dlLevel);
            const text = `DL${sign} ${Math.abs(dlLevel).toFixed(2)}m`;

            ctx.font = '600 11px Inter, sans-serif';
            const tw = ctx.measureText(text).width;

            // 밑줄 (흰색)
            ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1; ctx.setLineDash([]);
            ctx.beginPath();
            ctx.moveTo(dlBaseX - tw - 4, yCanv);
            ctx.lineTo(dlBaseX, yCanv);
            ctx.stroke();

            // 점선 안내선: 밑줄 끝 → 벽면까지 연결
            ctx.setLineDash([3, 3]);
            ctx.strokeStyle = 'rgba(255,255,255,0.4)';
            ctx.beginPath();
            ctx.moveTo(dlBaseX, yCanv);
            ctx.lineTo(this.wx(0), yCanv);
            ctx.stroke();
            ctx.setLineDash([]);

            // 텍스트 (Stroke Text 적용)
            this._drawT(ctx, text, dlBaseX, yCanv - 2, { align: 'right', baseline: 'bottom', font: '600 11px Inter, sans-serif' });
        };
        drawDL(data.cap.bottomEL + data.cap.height);
        drawDL(data.cap.bottomEL);
        bp.blocks.forEach(blk => drawDL(data.seabedEL + data.rubbleHeight + blk.bottom));
        drawDL(data.seabedEL);

        ctx.restore();
    }

    _drawVertDim(ctx, worldX, bottom, top, label, color) {
        const x = this.wx(worldX);
        const y1 = this.wy(bottom), y2 = this.wy(top);
        ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, y1); ctx.lineTo(x, y2); ctx.stroke();
        this._drawArrow(ctx, x, y2, 'up', color);
        this._drawArrow(ctx, x, y1, 'down', color);
        ctx.beginPath();
        ctx.moveTo(x - 5, y1); ctx.lineTo(x + 5, y1);
        ctx.moveTo(x - 5, y2); ctx.lineTo(x + 5, y2);
        ctx.stroke();
        const midY = (y1 + y2) / 2;
        ctx.save();
        ctx.translate(x - 6, midY); // 선 왼쪽으로 약간 띄움
        ctx.rotate(-Math.PI / 2);  // 90도 회전
        this._drawT(ctx, label, 0, 0, { font: 'bold 11px Inter, sans-serif' });
        ctx.restore();
    }

    _drawHorizDim(ctx, worldX1, worldX2, worldY, label, color) {
        const x1 = this.wx(worldX1), x2 = this.wx(worldX2), y = this.wy(worldY);
        ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke();
        this._drawArrow(ctx, x1, y, 'left', color);
        this._drawArrow(ctx, x2, y, 'right', color);
        ctx.beginPath();
        ctx.moveTo(x1, y - 5); ctx.lineTo(x1, y + 5);
        ctx.moveTo(x2, y - 5); ctx.lineTo(x2, y + 5);
        ctx.stroke();
        this._drawT(ctx, label, (x1 + x2) / 2, y - 8, { font: 'bold 11px Inter, sans-serif', baseline: 'bottom' });
    }

    _drawSlope(ctx, wx, wy, vert, horiz, color, dir = 'right') {
        const jump = 4; // 법면에서 띄울 간격 (12에서 4로 축소)
        const x = this.wx(wx) + (dir === 'right' ? jump : -jump), y = this.wy(wy) - jump;
        const size = 22;
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([]);
        ctx.beginPath();
        if (dir === 'right') {
            ctx.moveTo(x, y);
            ctx.lineTo(x + size * horiz, y);
            ctx.lineTo(x + size * horiz, y + size * vert);
            ctx.lineTo(x, y);
            ctx.stroke();
            this._drawT(ctx, horiz.toString(), x + (size * horiz) / 2, y - 5, { font: 'bold 11px Inter, sans-serif' });
            this._drawT(ctx, vert.toString(), x + size * horiz + 5, y + (size * vert) / 2, { align: 'left', font: 'bold 11px Inter, sans-serif' });
        } else {
            ctx.moveTo(x, y);
            ctx.lineTo(x - size * horiz, y);
            ctx.lineTo(x - size * horiz, y + size * vert);
            ctx.lineTo(x, y);
            ctx.stroke();
            this._drawT(ctx, horiz.toString(), x - (size * horiz) / 2, y - 5, { font: 'bold 11px Inter, sans-serif' });
            this._drawT(ctx, vert.toString(), x - size * horiz - 5, y + (size * vert) / 2, { align: 'right', font: 'bold 11px Inter, sans-serif' });
        }
        ctx.restore();
    }

    _drawArrow(ctx, x, y, dir, color) {
        const s = 4;
        ctx.fillStyle = color;
        ctx.beginPath();
        if (dir === 'up') { ctx.moveTo(x, y); ctx.lineTo(x - s, y + s * 1.5); ctx.lineTo(x + s, y + s * 1.5); }
        else if (dir === 'down') { ctx.moveTo(x, y); ctx.lineTo(x - s, y - s * 1.5); ctx.lineTo(x + s, y - s * 1.5); }
        else if (dir === 'left') { ctx.moveTo(x, y); ctx.lineTo(x + s * 1.5, y - s); ctx.lineTo(x + s * 1.5, y + s); }
        else if (dir === 'right') { ctx.moveTo(x, y); ctx.lineTo(x - s * 1.5, y - s); ctx.lineTo(x - s * 1.5, y + s); }
        ctx.closePath();
        ctx.fill();
    }

    // [최적화: _drawRoundedRect 미사용 데드코드 제거됨]
    _drawLabels(data, bp) {
        const ctx = this.ctx;
        const _drawL = (wx, wy, text, color) => {
            this._drawT(ctx, text, this.wx(wx), this.wy(wy), { font: '600 12px "Noto Sans KR", Inter, sans-serif' });
        };
        _drawL(bp.cap.w / 2, bp.cap.bottom + bp.cap.h / 2, '상치콘크리트', this.colors.capLight);
        bp.blocks.forEach((blk, idx) => {
            _drawL(blk.w / 2, blk.bottom + blk.h / 2, `블록 ${bp.blocks.length - idx}`, this.blockColors[idx % this.blockColors.length].light);
        });
    }

    _drawCL(data, bp) {
        const ctx = this.ctx;
        const H = this.canvas.height;

        // 1. CL 라인 (블록 해측 x=0)
        ctx.strokeStyle = '#ff3d00'; // 강렬한 주황/빨강
        ctx.lineWidth = 2;
        ctx.setLineDash([10, 5, 2, 5]); // 1점 쇄선
        ctx.beginPath();
        ctx.moveTo(this.wx(0), 0);
        ctx.lineTo(this.wx(0), H);
        ctx.stroke();
        ctx.setLineDash([]);

        // CL 라벨
        this._drawT(ctx, 'C.L', this.wx(0), 40, { font: 'bold 14px Inter, sans-serif' });

        // 2. 수량구분선 (필터사석 원지반 지점 기준 5m 간격)
        const rubH = data.rubbleHeight;
        const yTop = bp.cap.top;
        const H_pave = 0.2;
        const H_sub = 0.3;
        const yBackfillTop = yTop - (H_pave + H_sub);
        const ySeabed = -rubH;
        const hDrop = yBackfillTop - ySeabed;

        // 필터사석이 원지반과 만나는 x좌표
        const xMeet = (bp.maxW + 0.5) + hDrop * 1.2;

        // 5m 간격 올림 (예: 16.26m -> 20m)
        const limitX = Math.ceil(xMeet / 5) * 5;

        ctx.strokeStyle = '#00ff00'; // 형광 연두색
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 4]);
        ctx.font = 'bold 12px Inter, sans-serif';
        ctx.textAlign = 'center';

        // 단일 수량구분선만 표시
        const canvasX = this.wx(limitX);
        const yStart = this.wy(yTop + 1.0);
        const yEnd = this.wy(-rubH - 2.0);

        ctx.beginPath();
        ctx.moveTo(canvasX, yStart);
        ctx.lineTo(canvasX, yEnd);
        ctx.stroke();

        // 텍스트 배경 및 '수량구분선' 라벨 포함
        const txt = `수량구분선 (${limitX}m)`;
        const tw = ctx.measureText(txt).width;
        const yTxt = this.wy(-rubH - 1.0);

        // 배경 박스 삭제 및 테두리 텍스트 적용
        this._drawT(ctx, txt, canvasX, yTxt + 6, { font: 'bold 12px Inter, sans-serif' });

        ctx.setLineDash([]);
    }
}

window.QuayWallVisualization = QuayWallVisualization;
