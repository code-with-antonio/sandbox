/**
 * The frame half of the preview's health check.
 *
 * A game that throws on load leaves a black iframe and nothing else: the
 * exception is printed inside the frame's console, on a different origin from
 * the app, where neither the player nor the agent's next turn can see it. This
 * script is what carries it back out.
 *
 * It is deliberately a plain classic script, and deliberately its own file:
 *
 * - Classic, because a module is deferred, and a reporter that runs after the
 *   game does is a reporter that misses the game failing to start.
 * - Separate, because a syntax error is thrown when a script is compiled, not
 *   when it runs. Code sharing a file with the mistake never executes, so the
 *   only handler that can report a syntax error in main.js is one installed by
 *   a file that was already parsed and run — this one.
 *
 * It must therefore stay the first script in index.html, above the import map
 * and above the game's own modules.
 */

;(function () {
  var PING = "game-ping"
  var STATUS = "game-status"

  // Long stacks are mostly three.js internals, and the whole report has to
  // survive a postMessage and a trip through the app. A couple of thousand
  // characters is several frames deep, which is as far as anyone reads.
  var MAX_MESSAGE = 1000
  var MAX_STACK = 2000

  // The first failure only. Everything after it is usually the same mistake
  // arriving again from the render loop, a few hundred times a second, and the
  // cascade buries the one error that explains the screen.
  var firstError = null

  function clamp(value, limit) {
    var text = String(value)
    return text.length > limit ? text.slice(0, limit) + "…" : text
  }

  function record(report) {
    if (firstError) return
    firstError = report
  }

  /**
   * A thrown value, flattened to something structured and serialisable.
   *
   * `error` is whatever was thrown, which is an Error most of the time and a
   * string, an object or nothing the rest of it — hence the fallbacks, and
   * hence reading `stack` only when it is there to read.
   */
  function describe(error, message, source, line, column) {
    var thrown = error && typeof error === "object" ? error : null

    return {
      message: clamp(
        message || (thrown && thrown.message) || error || "Unknown error",
        MAX_MESSAGE
      ),
      source: source ? String(source) : "",
      line: typeof line === "number" ? line : null,
      column: typeof column === "number" ? column : null,
      stack: thrown && thrown.stack ? clamp(thrown.stack, MAX_STACK) : "",
    }
  }

  window.addEventListener(
    "error",
    function (event) {
      var target = event.target

      // A <script> or <img> that 404s fires a bare Event at the element rather
      // than an ErrorEvent at the window, and that one does not bubble — which
      // is what the capture phase here is for. It carries no message, so the
      // url that failed is the entire report, and it is worth having: a
      // mistyped module path is otherwise a blank screen with a silent console.
      if (target && target !== window && (target.src || target.href)) {
        record(describe(null, "Failed to load " + (target.src || target.href)))
        return
      }

      // Uncaught exceptions and, the reason this file exists, syntax errors in
      // any script on the page. `event.error` is absent for the second kind in
      // some browsers, so the message is taken from the event first.
      record(
        describe(
          event.error,
          event.message,
          event.filename,
          event.lineno,
          event.colno
        )
      )
    },
    true
  )

  // A rejected load — a texture, a fetch, an await in a start-up path — fails
  // just as visibly as a throw and never reaches the handler above.
  window.addEventListener("unhandledrejection", function (event) {
    var reason = event.reason
    var described = describe(reason)
    described.message = clamp(
      "Unhandled rejection: " + described.message,
      MAX_MESSAGE
    )
    record(described)
  })

  // The app polls rather than the frame pushing, because the frame is usually
  // broken before the app is listening — the error that matters most is thrown
  // during load, while the preview panel is still mounting. Holding it and
  // answering on request means it survives that gap, and means a poll that
  // finds nothing is itself the signal that the game is running.
  window.addEventListener("message", function (event) {
    var data = event.data
    if (!data || data.type !== PING) return

    // `error: null` rather than silence: an answered ping is how the app tells
    // a healthy game from one that never got far enough to install this
    // handler, and the two want very different things on screen.
    //
    // Replies go back to whoever asked, at any origin. The frame is served
    // from a signed sandbox url and cannot know the app's origin ahead of
    // time, and the reply says nothing the game's own source doesn't.
    var source = event.source || window.parent
    if (!source) return

    source.postMessage({ type: STATUS, error: firstError }, "*")
  })
})()
