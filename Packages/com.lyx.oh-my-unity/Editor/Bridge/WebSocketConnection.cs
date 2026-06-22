using System;
using System.IO;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;

namespace Lyx.OhMyUnity.Editor
{
    /// <summary>
    /// Minimal RFC 6455 server-side WebSocket over a raw <see cref="TcpClient"/> stream. Unity's Mono
    /// HttpListener server-side WebSocket support is unreliable across platforms, so the bridge speaks
    /// the framing directly. Only the subset the UOS opencode tools exercise is implemented:
    /// the upgrade handshake, masked client text frames, unmasked server text frames, and the
    /// ping/pong/close control frames.
    ///
    /// This socket/runtime behavior is the human-verified boundary -- it cannot run headless. The
    /// deterministic protocol (message shapes, handshake rules) is unit-tested on the UOS client side.
    /// </summary>
    internal sealed class WebSocketConnection : IDisposable
    {
        private const string WebSocketGuid = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
        private const int MaxHandshakeBytes = 16 * 1024;
        private const long MaxPayloadBytes = 16L * 1024 * 1024;

        private readonly TcpClient _client;
        private readonly NetworkStream _stream;
        private readonly object _writeLock = new object();
        private bool _disposed;

        private WebSocketConnection(TcpClient client, NetworkStream stream)
        {
            _client = client;
            _stream = stream;
        }

        /// <summary>
        /// Perform the HTTP upgrade handshake. Returns a live connection on success, or null if the
        /// request was not a valid WebSocket upgrade (the underlying socket is closed in that case).
        /// </summary>
        public static WebSocketConnection Accept(TcpClient client)
        {
            NetworkStream stream = client.GetStream();
            try
            {
                string key = ReadHandshakeKey(stream);
                if (string.IsNullOrEmpty(key))
                {
                    stream.Dispose();
                    client.Close();
                    return null;
                }

                string response =
                    "HTTP/1.1 101 Switching Protocols\r\n" +
                    "Upgrade: websocket\r\n" +
                    "Connection: Upgrade\r\n" +
                    "Sec-WebSocket-Accept: " + ComputeAccept(key) + "\r\n\r\n";
                byte[] bytes = Encoding.ASCII.GetBytes(response);
                stream.Write(bytes, 0, bytes.Length);
                stream.Flush();
                return new WebSocketConnection(client, stream);
            }
            catch
            {
                stream.Dispose();
                client.Close();
                return null;
            }
        }

        /// <summary>
        /// Read the next application text message, transparently answering control frames (auto-pong,
        /// close). Returns null when the peer closes the connection or the stream ends.
        /// </summary>
        public string ReadMessage()
        {
            using var assembled = new MemoryStream();
            while (true)
            {
                Frame frame = ReadFrame();
                if (frame == null) return null;

                switch (frame.Opcode)
                {
                    case 0x8: // close
                        TrySendControl(0x8, Array.Empty<byte>());
                        return null;
                    case 0x9: // ping -> pong
                        TrySendControl(0xA, frame.Payload);
                        continue;
                    case 0xA: // pong
                        continue;
                    case 0x0: // continuation
                    case 0x1: // text
                    case 0x2: // binary
                        assembled.Write(frame.Payload, 0, frame.Payload.Length);
                        if (frame.Fin)
                        {
                            return Encoding.UTF8.GetString(assembled.ToArray());
                        }
                        continue;
                    default:
                        continue;
                }
            }
        }

        /// <summary>Send an application text message as a single unmasked frame.</summary>
        public void SendText(string text)
        {
            byte[] payload = Encoding.UTF8.GetBytes(text);
            byte[] frame = BuildFrame(0x1, payload);
            lock (_writeLock)
            {
                _stream.Write(frame, 0, frame.Length);
                _stream.Flush();
            }
        }

        public void Dispose()
        {
            if (_disposed) return;
            _disposed = true;
            try { TrySendControl(0x8, Array.Empty<byte>()); } catch { /* best effort */ }
            try { _stream.Dispose(); } catch { /* best effort */ }
            try { _client.Close(); } catch { /* best effort */ }
        }

        private sealed class Frame
        {
            public bool Fin;
            public int Opcode;
            public byte[] Payload;
        }

        private Frame ReadFrame()
        {
            var head = new byte[2];
            if (!ReadExactly(head, 2)) return null;

            bool fin = (head[0] & 0x80) != 0;
            int opcode = head[0] & 0x0F;
            bool masked = (head[1] & 0x80) != 0;
            long len = head[1] & 0x7F;

            if (len == 126)
            {
                var ext = new byte[2];
                if (!ReadExactly(ext, 2)) return null;
                len = (ext[0] << 8) | ext[1];
            }
            else if (len == 127)
            {
                var ext = new byte[8];
                if (!ReadExactly(ext, 8)) return null;
                len = 0;
                for (int i = 0; i < 8; i++) len = (len << 8) | ext[i];
            }

            if (len < 0 || len > MaxPayloadBytes)
            {
                throw new IOException($"websocket: frame too large ({len} bytes)");
            }

            byte[] mask = null;
            if (masked)
            {
                mask = new byte[4];
                if (!ReadExactly(mask, 4)) return null;
            }

            var payload = new byte[len];
            if (len > 0 && !ReadExactly(payload, (int)len)) return null;

            if (masked)
            {
                for (int i = 0; i < payload.Length; i++)
                {
                    payload[i] ^= mask[i & 3];
                }
            }

            return new Frame { Fin = fin, Opcode = opcode, Payload = payload };
        }

        private bool ReadExactly(byte[] buffer, int count)
        {
            int offset = 0;
            while (offset < count)
            {
                int read = _stream.Read(buffer, offset, count - offset);
                if (read <= 0) return false;
                offset += read;
            }
            return true;
        }

        private void TrySendControl(int opcode, byte[] payload)
        {
            try
            {
                byte[] frame = BuildFrame(opcode, payload ?? Array.Empty<byte>());
                lock (_writeLock)
                {
                    _stream.Write(frame, 0, frame.Length);
                    _stream.Flush();
                }
            }
            catch
            {
                /* best effort: peer may already be gone */
            }
        }

        private static byte[] BuildFrame(int opcode, byte[] payload)
        {
            int length = payload.Length;
            byte[] header;
            if (length <= 125)
            {
                header = new byte[2];
                header[1] = (byte)length;
            }
            else if (length <= ushort.MaxValue)
            {
                header = new byte[4];
                header[1] = 126;
                header[2] = (byte)((length >> 8) & 0xFF);
                header[3] = (byte)(length & 0xFF);
            }
            else
            {
                header = new byte[10];
                header[1] = 127;
                long ext = length;
                for (int i = 0; i < 8; i++)
                {
                    header[9 - i] = (byte)(ext & 0xFF);
                    ext >>= 8;
                }
            }
            header[0] = (byte)(0x80 | (opcode & 0x0F)); // FIN + opcode; server frames are never masked

            var frame = new byte[header.Length + length];
            Buffer.BlockCopy(header, 0, frame, 0, header.Length);
            Buffer.BlockCopy(payload, 0, frame, header.Length, length);
            return frame;
        }

        private static string ReadHandshakeKey(NetworkStream stream)
        {
            var buffer = new MemoryStream();
            var one = new byte[1];
            while (buffer.Length < MaxHandshakeBytes)
            {
                int read = stream.Read(one, 0, 1);
                if (read <= 0) return null;
                buffer.WriteByte(one[0]);
                if (EndsWithDoubleCrlf(buffer)) break;
            }

            string request = Encoding.ASCII.GetString(buffer.ToArray());
            foreach (string line in request.Split('\n'))
            {
                string trimmed = line.Trim();
                const string header = "Sec-WebSocket-Key:";
                if (trimmed.StartsWith(header, StringComparison.OrdinalIgnoreCase))
                {
                    return trimmed.Substring(header.Length).Trim();
                }
            }
            return null;
        }

        private static bool EndsWithDoubleCrlf(MemoryStream buffer)
        {
            if (buffer.Length < 4) return false;
            byte[] bytes = buffer.GetBuffer();
            long n = buffer.Length;
            return bytes[n - 4] == '\r' && bytes[n - 3] == '\n' && bytes[n - 2] == '\r' && bytes[n - 1] == '\n';
        }

        private static string ComputeAccept(string key)
        {
            using var sha1 = SHA1.Create();
            byte[] hash = sha1.ComputeHash(Encoding.ASCII.GetBytes(key + WebSocketGuid));
            return Convert.ToBase64String(hash);
        }
    }
}
