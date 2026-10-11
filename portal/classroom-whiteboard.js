(() => {
  const NS = "nips-whiteboard-v1";
  window.createNipsWhiteboard = (api, { isTeacher, relay }) => {
    const panel = document.getElementById("nips-board");
    const canvas = document.getElementById("nips-board-canvas");
    const tools = document.getElementById("nips-board-tools");
    const status = document.getElementById("nips-board-status");
    const openButton = document.getElementById("open-board");
    const context = canvas.getContext("2d");
    let strokes = [];
    let activeStroke = null;
    let teacherId = null;
    let localId = null;
    let boardOpen = false;
    let studentsCanWrite = false;
    let color = "#173f2a";
    let width = 3;
    let mode = "pen";
    let camera = { x: 0, y: 0 };
    let panStart = null;
    let viewTimer = null;
    let viewCommitTimer = null;
    let channelReady = false;
    const outbox = [];
    const seen = new Set();

    const isModerator = async id => {
      const info = await api.getRoomsInfo?.();
      const rooms = Array.isArray(info) ? info : (info?.rooms || []);
      return rooms.some(room => (room.participants || []).some(person => person.id === id && person.role === "moderator"));
    };
    const canWrite = () => isTeacher || studentsCanWrite;
    const participantIds = async () => {
      try {
        const info = await api.getRoomsInfo?.();
        const rooms = Array.isArray(info) ? info : (info?.rooms || []);
        return [...new Set(rooms.flatMap(room => room.participants || []).map(person => person.id).filter(id => id && id !== localId))];
      } catch (_) {
        return (api.getParticipantsInfo?.() || []).map(person => person.participantId || person.id).filter(id => id && id !== localId);
      }
    };
    const deliver = async ({ message, recipient }) => {
      const text = JSON.stringify(message);
      const recipients = recipient ? [recipient] : await participantIds();
      recipients.forEach(id => api.executeCommand("sendEndpointTextMessage", id, text));
    };
    const send = (kind, data = {}, recipient = "") => {
      const message = { ns: NS, id: crypto.randomUUID(), kind, ...data };
      const delivery = { message, recipient };
      relay?.({ senderId: localId, senderRole: isTeacher ? "teacher" : "observer", recipient, message });
      if (!channelReady) outbox.push(delivery); else deliver(delivery);
    };
    const openChannel = () => {
      if (channelReady) return;
      channelReady = true;
      outbox.splice(0).forEach(deliver);
    };

    const fit = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      const nextWidth = Math.max(1, Math.round(rect.width * ratio));
      const nextHeight = Math.max(1, Math.round(rect.height * ratio));
      if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
        canvas.width = nextWidth;
        canvas.height = nextHeight;
        draw();
      }
    };
    const drawStroke = stroke => {
      if (!stroke?.points?.length) return;
      context.strokeStyle = stroke.color || "#173f2a";
      const ratio = canvas.width / Math.max(1, canvas.clientWidth);
      context.lineWidth = (stroke.width || 3) * ratio;
      context.lineCap = "round";
      context.lineJoin = "round";
      context.beginPath();
      stroke.points.forEach((point, index) => {
        const x = (point[0] - camera.x) * ratio, y = (point[1] - camera.y) * ratio;
        if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
      });
      if (stroke.points.length === 1) context.lineTo((stroke.points[0][0] - camera.x) * ratio + .1, (stroke.points[0][1] - camera.y) * ratio + .1);
      context.stroke();
    };
    const draw = () => {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      strokes.forEach(drawStroke);
      if (activeStroke) drawStroke(activeStroke);
    };
    const show = () => {
      boardOpen = true;
      panel.hidden = false;
      requestAnimationFrame(fit);
    };
    const hide = () => { boardOpen = false; panel.hidden = true; };
    const publishState = (recipient = "") => send("state", { open: boardOpen, strokes, studentsCanWrite, camera }, recipient);
    const publishView = () => {
      clearTimeout(viewTimer);
      viewTimer = setTimeout(() => send("view", { camera }), 35);
      clearTimeout(viewCommitTimer);
      viewCommitTimer = setTimeout(() => publishState(), 250);
    };
    const setMode = next => {
      mode = next;
      ["pen", "eraser", "pan"].forEach(name => document.getElementById(`nips-board-${name}`)?.classList.toggle("green", name === mode));
      canvas.style.cursor = mode === "pan" ? "grab" : mode === "eraser" ? "cell" : canWrite() ? "crosshair" : "default";
    };
    const updatePermissionUi = () => {
      status.textContent = isTeacher
        ? `Teacher editing · student writing ${studentsCanWrite ? "enabled" : "disabled"}`
        : studentsCanWrite ? "Your teacher has allowed student writing" : "Teacher controlled · read-only";
      const permission = document.getElementById("nips-board-permission");
      if (permission) permission.textContent = studentsCanWrite ? "Disable student writing" : "Allow student writing";
      setMode(mode);
    };

    if (isTeacher) {
      openButton.classList.add("available");
      tools.innerHTML = '<button class="btn green sm" id="nips-board-pen" type="button">Pen</button><button class="btn soft sm" id="nips-board-eraser" type="button">Eraser</button><button class="btn soft sm" id="nips-board-pan" type="button">Move canvas</button><input type="color" id="nips-board-color" value="#173f2a" aria-label="Pen colour"><label class="meta">Size <input type="range" id="nips-board-size" min="1" max="12" value="3"></label><button class="btn soft sm" id="nips-board-undo" type="button">Undo</button><button class="btn soft sm" id="nips-board-clear" type="button">Clear board</button><button class="btn soft sm" id="nips-board-permission" type="button">Allow student writing</button><button class="btn green sm" id="nips-board-close" type="button">Return to class</button>';
      openButton.onclick = () => { show(); publishState(); };
      document.getElementById("nips-board-color").oninput = event => { color = event.target.value; };
      document.getElementById("nips-board-size").oninput = event => { width = Number(event.target.value); };
      document.getElementById("nips-board-pen").onclick = () => setMode("pen");
      document.getElementById("nips-board-eraser").onclick = () => setMode("eraser");
      document.getElementById("nips-board-pan").onclick = () => setMode("pan");
      document.getElementById("nips-board-undo").onclick = () => { strokes.pop(); draw(); publishState(); };
      document.getElementById("nips-board-clear").onclick = () => { if (confirm("Clear the whiteboard for everyone?")) { strokes = []; draw(); publishState(); } };
      document.getElementById("nips-board-permission").onclick = () => { studentsCanWrite = !studentsCanWrite; updatePermissionUi(); send("permission", { studentsCanWrite }); };
      document.getElementById("nips-board-close").onclick = () => { hide(); send("close"); };
    } else {
      tools.innerHTML = '<span class="meta" id="nips-board-readonly">Waiting for the teacher…</span>';
    }

    const pointFromEvent = event => {
      const rect = canvas.getBoundingClientRect();
      return [event.clientX - rect.left + camera.x, event.clientY - rect.top + camera.y];
    };
    const eraseAt = point => {
      const before = strokes.length;
      strokes = strokes.filter(stroke => !stroke.points?.some(p => Math.hypot(p[0] - point[0], p[1] - point[1]) <= Math.max(12, width * 3)));
      if (strokes.length !== before) { draw(); publishState(); }
    };
    canvas.addEventListener("pointerdown", event => {
      if (mode === "pan" && isTeacher) {
        canvas.setPointerCapture(event.pointerId);
        panStart = { clientX: event.clientX, clientY: event.clientY, x: camera.x, y: camera.y };
        canvas.style.cursor = "grabbing";
        return;
      }
      if (!canWrite()) return;
      canvas.setPointerCapture(event.pointerId);
      if (mode === "eraser" && isTeacher) { eraseAt(pointFromEvent(event)); return; }
      activeStroke = { color, width, points: [pointFromEvent(event)] };
      draw();
    });
    canvas.addEventListener("pointermove", event => {
      if (panStart) {
        camera = { x: panStart.x - (event.clientX - panStart.clientX), y: panStart.y - (event.clientY - panStart.clientY) };
        draw(); publishView(); return;
      }
      if (mode === "eraser" && isTeacher && event.buttons) { eraseAt(pointFromEvent(event)); return; }
      if (!activeStroke || !canWrite()) return;
      activeStroke.points.push(pointFromEvent(event));
      draw();
    });
    const finishStroke = () => {
      if (panStart) {
        panStart = null;
        setMode("pan");
        clearTimeout(viewTimer);
        clearTimeout(viewCommitTimer);
        send("view", { camera });
        publishState();
        return;
      }
      if (!activeStroke) return;
      const stroke = activeStroke;
      activeStroke = null;
      if (isTeacher) {
        strokes.push(stroke);
        draw();
        send("stroke", { stroke });
      } else if (studentsCanWrite && teacherId) {
        send("proposal", { stroke }, teacherId);
        draw();
      }
    };
    canvas.addEventListener("pointerup", finishStroke);
    canvas.addEventListener("pointercancel", finishStroke);
    canvas.addEventListener("wheel", event => {
      if (!isTeacher) return;
      event.preventDefault();
      camera = { x: camera.x + (event.shiftKey && !event.deltaX ? event.deltaY : event.deltaX), y: camera.y + (event.shiftKey ? 0 : event.deltaY) };
      draw(); publishView();
    }, { passive: false });

    const receive = async (senderId, message, trustedTeacher = false) => {
      if (message?.ns !== NS || (message.id && seen.has(message.id))) return;
      if (message.id) {
        seen.add(message.id);
        if (seen.size > 1000) seen.delete(seen.values().next().value);
      }
      if (isTeacher) {
        if (message.kind === "request-state") publishState(senderId);
        if (message.kind === "proposal" && studentsCanWrite && message.stroke) {
          strokes.push(message.stroke);
          draw();
          send("stroke", { stroke: message.stroke });
        }
        return;
      }
      if (!teacherId && (trustedTeacher || await isModerator(senderId))) teacherId = senderId;
      if (!teacherId || senderId !== teacherId) return;
      if (message.kind === "state") {
        strokes = Array.isArray(message.strokes) ? message.strokes : [];
        camera = message.camera && Number.isFinite(message.camera.x) && Number.isFinite(message.camera.y) ? message.camera : camera;
        studentsCanWrite = Boolean(message.studentsCanWrite);
        message.open ? show() : hide();
        draw();
      } else if (message.kind === "stroke" && message.stroke) {
        strokes.push(message.stroke); draw();
      } else if (message.kind === "permission") {
        studentsCanWrite = Boolean(message.studentsCanWrite);
      } else if (message.kind === "view" && message.camera) {
        camera = message.camera; draw();
      } else if (message.kind === "close") hide();
      updatePermissionUi();
    };
    api.addEventListener("endpointTextMessageReceived", async ({ senderInfo, eventData }) => {
      let message;
      try { message = JSON.parse(eventData?.text || ""); } catch (_) { return; }
      receive(senderInfo?.id, message);
    });
    api.addEventListener("dataChannelOpened", openChannel);
    api.addEventListener("participantJoined", ({ id }) => { if (isTeacher) publishState(id); });
    window.addEventListener("resize", fit);
    new ResizeObserver(fit).observe(canvas);
    updatePermissionUi();

    return {
      onRelay(payload) {
        if (!payload?.message || payload.senderId === localId) return;
        if (payload.recipient && payload.recipient !== localId) return;
        receive(payload.senderId, payload.message, payload.senderRole === "teacher");
      },
      onJoined(event) {
        localId = event?.id || null;
        // dataChannelOpened can precede videoConferenceJoined on fast/reused
        // mobile sessions. Retry after join so a missed one-time event cannot
        // strand whiteboard messages in the queue.
        setTimeout(openChannel, 1200);
        if (isTeacher) {
          teacherId = localId;
          [600, 2200, 5000].forEach(delay => setTimeout(() => publishState(), delay));
        } else {
          [800, 2500, 5500].forEach(delay => setTimeout(() => send("request-state"), delay));
        }
      }
    };
  };
})();
