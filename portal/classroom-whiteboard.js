(() => {
  const NS = "nips-whiteboard-v1";
  const clamp = value => Math.max(0, Math.min(1, value));

  window.createNipsWhiteboard = (api, { isTeacher }) => {
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

    const isModerator = async id => {
      const info = await api.getRoomsInfo?.();
      const rooms = Array.isArray(info) ? info : (info?.rooms || []);
      return rooms.some(room => (room.participants || []).some(person => person.id === id && person.role === "moderator"));
    };
    const canWrite = () => isTeacher || studentsCanWrite;
    const send = (kind, data = {}, recipient = "") => {
      api.executeCommand("sendEndpointTextMessage", recipient, JSON.stringify({ ns: NS, kind, ...data }));
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
      context.lineWidth = (stroke.width || 3) * (canvas.width / Math.max(320, canvas.clientWidth));
      context.lineCap = "round";
      context.lineJoin = "round";
      context.beginPath();
      stroke.points.forEach((point, index) => {
        const x = point[0] * canvas.width, y = point[1] * canvas.height;
        if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
      });
      if (stroke.points.length === 1) context.lineTo(stroke.points[0][0] * canvas.width + .1, stroke.points[0][1] * canvas.height + .1);
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
    const publishState = (recipient = "") => send("state", { open: boardOpen, strokes, studentsCanWrite }, recipient);
    const updatePermissionUi = () => {
      status.textContent = isTeacher
        ? `Teacher editing · student writing ${studentsCanWrite ? "enabled" : "disabled"}`
        : studentsCanWrite ? "Your teacher has allowed student writing" : "Teacher controlled · read-only";
      const permission = document.getElementById("nips-board-permission");
      if (permission) permission.textContent = studentsCanWrite ? "Disable student writing" : "Allow student writing";
      canvas.style.cursor = canWrite() ? "crosshair" : "default";
    };

    if (isTeacher) {
      openButton.classList.add("available");
      tools.innerHTML = '<input type="color" id="nips-board-color" value="#173f2a" aria-label="Pen colour"><label class="meta">Size <input type="range" id="nips-board-size" min="1" max="12" value="3"></label><button class="btn soft sm" id="nips-board-undo" type="button">Undo</button><button class="btn soft sm" id="nips-board-clear" type="button">Clear</button><button class="btn soft sm" id="nips-board-permission" type="button">Allow student writing</button><button class="btn green sm" id="nips-board-close" type="button">Return to class</button>';
      openButton.onclick = () => { show(); publishState(); };
      document.getElementById("nips-board-color").oninput = event => { color = event.target.value; };
      document.getElementById("nips-board-size").oninput = event => { width = Number(event.target.value); };
      document.getElementById("nips-board-undo").onclick = () => { strokes.pop(); draw(); publishState(); };
      document.getElementById("nips-board-clear").onclick = () => { if (confirm("Clear the whiteboard for everyone?")) { strokes = []; draw(); publishState(); } };
      document.getElementById("nips-board-permission").onclick = () => { studentsCanWrite = !studentsCanWrite; updatePermissionUi(); send("permission", { studentsCanWrite }); };
      document.getElementById("nips-board-close").onclick = () => { hide(); send("close"); };
    } else {
      tools.innerHTML = '<span class="meta" id="nips-board-readonly">Waiting for the teacher…</span>';
    }

    const pointFromEvent = event => {
      const rect = canvas.getBoundingClientRect();
      return [clamp((event.clientX - rect.left) / rect.width), clamp((event.clientY - rect.top) / rect.height)];
    };
    canvas.addEventListener("pointerdown", event => {
      if (!canWrite()) return;
      canvas.setPointerCapture(event.pointerId);
      activeStroke = { color, width, points: [pointFromEvent(event)] };
      draw();
    });
    canvas.addEventListener("pointermove", event => {
      if (!activeStroke || !canWrite()) return;
      activeStroke.points.push(pointFromEvent(event));
      draw();
    });
    const finishStroke = () => {
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

    api.addEventListener("endpointTextMessageReceived", async ({ senderInfo, eventData }) => {
      let message;
      try { message = JSON.parse(eventData?.text || ""); } catch (_) { return; }
      if (message?.ns !== NS) return;
      const senderId = senderInfo?.id;
      if (isTeacher) {
        if (message.kind === "request-state") publishState(senderId);
        if (message.kind === "proposal" && studentsCanWrite && message.stroke) {
          strokes.push(message.stroke);
          draw();
          send("stroke", { stroke: message.stroke });
        }
        return;
      }
      if (!teacherId && await isModerator(senderId)) teacherId = senderId;
      if (!teacherId || senderId !== teacherId) return;
      if (message.kind === "state") {
        strokes = Array.isArray(message.strokes) ? message.strokes : [];
        studentsCanWrite = Boolean(message.studentsCanWrite);
        message.open ? show() : hide();
        draw();
      } else if (message.kind === "stroke" && message.stroke) {
        strokes.push(message.stroke); draw();
      } else if (message.kind === "permission") {
        studentsCanWrite = Boolean(message.studentsCanWrite);
      } else if (message.kind === "close") hide();
      updatePermissionUi();
    });
    api.addEventListener("participantJoined", ({ id }) => { if (isTeacher) publishState(id); });
    window.addEventListener("resize", fit);
    new ResizeObserver(fit).observe(canvas);
    updatePermissionUi();

    return {
      onJoined(event) {
        localId = event?.id || null;
        if (isTeacher) {
          teacherId = localId;
          setTimeout(() => publishState(), 600);
        } else setTimeout(() => send("request-state"), 800);
      }
    };
  };
})();
