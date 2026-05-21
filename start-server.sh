#!/bin/bash
# LLMs Web Server startup script

PIDFILE=/tmp/llms.pid
LOGFILE=/tmp/llms.log

case "${1:-}" in
  start)
    if [ -f "$PIDFILE" ] && kill -0 $(cat "$PIDFILE") 2>/dev/null; then
      echo "llms server is already running (pid: $(cat $PIDFILE))"
      exit 1
    fi
    echo "starting llms server..."
    cd /home/house/llms
    nohup node server.js >> "$LOGFILE" 2>&1 &
    echo $! > "$PIDFILE"
    sleep 2
    if kill -0 $(cat "$PIDFILE") 2>/dev/null; then
      echo "llms server started on port 3456 (pid: $(cat $PIDFILE))"
      echo "access it at: http://localhost:3456"
    else
      echo "failed to start llms server"
      rm -f "$PIDFILE"
      exit 1
    fi
    ;;
  stop)
    if [ -f "$PIDFILE" ] && kill -0 $(cat "$PIDFILE") 2>/dev/null; then
      echo "stopping llms server (pid: $(cat $PIDFILE))..."
      kill $(cat "$PIDFILE")
      rm -f "$PIDFILE"
      echo "llms server stopped"
    else
      echo "llms server is not running"
      rm -f "$PIDFILE"
    fi
    ;;
  restart)
    $0 stop
    sleep 1
    $0 start
    ;;
  status)
    if [ -f "$PIDFILE" ] && kill -0 $(cat "$PIDFILE") 2>/dev/null; then
      echo "llms server is running (pid: $(cat $PIDFILE))"
      echo "listening on port 3456"
      echo "access it at: http://localhost:3456"
    else
      echo "llms server is not running"
      rm -f "$PIDFILE"
    fi
    ;;
  logs)
    tail -f "$LOGFILE"
    ;;
  *)
    echo "usage: $0 {start|stop|restart|status|logs}"
    echo ""
    echo "the llms server runs on port 3456 by default."
    echo "to use a different port, set the PORT environment variable:"
    echo "  PORT=8080 $0 start"
    exit 1
    ;;
esac
