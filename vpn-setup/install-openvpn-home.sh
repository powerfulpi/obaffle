#!/usr/bin/env bash
set -euo pipefail
umask 077

PORT=${PORT:-443}
WAN_IF=${WAN_IF:-enp3s0}
CLIENT_USER=${CLIENT_USER:-aidensmith}
PUBLIC_HOST=${PUBLIC_HOST:-45.36.195.136}
VPN_DIR=/etc/openvpn/home
BACKUP_DIR=/root/openvpn-home-backup-$(date +%Y%m%d-%H%M%S)

if (( EUID != 0 )); then echo 'Run with sudo.' >&2; exit 1; fi
if ss -H -ltn "sport = :$PORT" | grep -q .; then echo "TCP $PORT is already in use." >&2; exit 1; fi
if [[ -e "$VPN_DIR" ]]; then echo "$VPN_DIR already exists; refusing to overwrite it." >&2; exit 1; fi
getent passwd "$CLIENT_USER" >/dev/null
command -v iptables >/dev/null
command -v ip6tables >/dev/null
mkdir -p "$BACKUP_DIR" "$VPN_DIR" /etc/systemd/system/openvpn-server@home.service.d
chmod 700 "$BACKUP_DIR" "$VPN_DIR"
cp -a /etc/ufw "$BACKUP_DIR/ufw" 2>/dev/null || true
cp -a /etc/wireguard "$BACKUP_DIR/wireguard" 2>/dev/null || true
iptables-save > "$BACKUP_DIR/iptables.v4"
ip6tables-save > "$BACKUP_DIR/iptables.v6"
sysctl -a 2>/dev/null | grep -E '^net\.ipv[46]\.conf\.all\.forwarding|^net\.ipv4\.ip_forward' > "$BACKUP_DIR/forwarding.txt" || true

apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y openvpn
mkdir -p /etc/openvpn/server

openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out "$VPN_DIR/ca.key" 2>/dev/null
openssl req -x509 -new -sha256 -days 3650 -key "$VPN_DIR/ca.key" -subj '/CN=Home VPN CA' -out "$VPN_DIR/ca.crt"
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out "$VPN_DIR/server.key" 2>/dev/null
openssl req -new -key "$VPN_DIR/server.key" -subj '/CN=home-vpn-server' -out "$VPN_DIR/server.csr"
printf 'basicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n' > "$VPN_DIR/server.ext"
openssl x509 -req -in "$VPN_DIR/server.csr" -CA "$VPN_DIR/ca.crt" -CAkey "$VPN_DIR/ca.key" -CAcreateserial -days 825 -sha256 -extfile "$VPN_DIR/server.ext" -out "$VPN_DIR/server.crt" >/dev/null 2>&1
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out "$VPN_DIR/mac.key" 2>/dev/null
openssl req -new -key "$VPN_DIR/mac.key" -subj '/CN=mac-home' -out "$VPN_DIR/mac.csr"
printf 'basicConstraints=CA:FALSE\nkeyUsage=digitalSignature\nextendedKeyUsage=clientAuth\n' > "$VPN_DIR/mac.ext"
openssl x509 -req -in "$VPN_DIR/mac.csr" -CA "$VPN_DIR/ca.crt" -CAkey "$VPN_DIR/ca.key" -CAcreateserial -days 825 -sha256 -extfile "$VPN_DIR/mac.ext" -out "$VPN_DIR/mac.crt" >/dev/null 2>&1
openvpn --genkey tls-crypt "$VPN_DIR/tc.key" >/dev/null 2>&1

cat > /etc/openvpn/server/home.conf <<EOF
port $PORT
proto tcp-server
dev tun-home
topology subnet
server 10.78.0.0 255.255.255.0
server-ipv6 fd77:78::/64
push "redirect-gateway def1 ipv6"
push "dhcp-option DNS 1.1.1.1"
push "dhcp-option DNS 1.0.0.1"
push "dhcp-option DNS6 2606:4700:4700::1111"
push "dhcp-option DNS6 2606:4700:4700::1001"
ca $VPN_DIR/ca.crt
cert $VPN_DIR/server.crt
key $VPN_DIR/server.key
tls-crypt $VPN_DIR/tc.key
dh none
verify-client-cert require
remote-cert-tls client
tls-version-min 1.2
data-ciphers AES-256-GCM:AES-128-GCM:CHACHA20-POLY1305
keepalive 10 120
persist-key
persist-tun
user nobody
group nogroup
verb 3
EOF
chmod 600 /etc/openvpn/server/home.conf

cat > /usr/local/sbin/openvpn-home-firewall <<EOF
#!/usr/bin/env bash
set -euo pipefail
action=\${1:-start}
rule() {
  local binary=\$1 table=\$2 chain=\$3; shift 3
  if [[ \$action == start ]]; then
    \$binary -t "\$table" -C "\$chain" "\$@" 2>/dev/null || \$binary -t "\$table" -I "\$chain" 1 "\$@"
  else
    \$binary -t "\$table" -C "\$chain" "\$@" 2>/dev/null && \$binary -t "\$table" -D "\$chain" "\$@" || true
  fi
}
rule iptables filter INPUT -i $WAN_IF -p tcp --dport $PORT -j ACCEPT
rule iptables filter FORWARD -i tun-home -o $WAN_IF -j ACCEPT
rule iptables filter FORWARD -i $WAN_IF -o tun-home -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT
rule iptables nat POSTROUTING -s 10.78.0.0/24 -o $WAN_IF -j MASQUERADE
rule ip6tables filter FORWARD -i tun-home -o $WAN_IF -j ACCEPT
rule ip6tables filter FORWARD -i $WAN_IF -o tun-home -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT
rule ip6tables nat POSTROUTING -s fd77:78::/64 -o $WAN_IF -j MASQUERADE
EOF
chmod 700 /usr/local/sbin/openvpn-home-firewall

cat > /etc/sysctl.d/90-openvpn-home.conf <<'EOF'
net.ipv4.ip_forward=1
net.ipv6.conf.all.forwarding=1
net.ipv6.conf.enp3s0.accept_ra=2
EOF
sysctl -p /etc/sysctl.d/90-openvpn-home.conf >/dev/null

cat > /etc/systemd/system/openvpn-home-firewall.service <<'EOF'
[Unit]
Description=OpenVPN home firewall rules
Before=openvpn-server@home.service
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/local/sbin/openvpn-home-firewall start
ExecStop=/usr/local/sbin/openvpn-home-firewall stop

[Install]
WantedBy=multi-user.target
EOF
cat > /etc/systemd/system/openvpn-server@home.service.d/firewall.conf <<'EOF'
[Unit]
Requires=openvpn-home-firewall.service
After=openvpn-home-firewall.service
EOF

PROFILE=$(getent passwd "$CLIENT_USER" | cut -d: -f6)/Home-Internet-TCP.ovpn
{
  cat <<EOF
client
dev tun
proto tcp-client
remote $PUBLIC_HOST $PORT
resolv-retry infinite
nobind
persist-key
persist-tun
remote-cert-tls server
verify-x509-name home-vpn-server name
tls-version-min 1.2
data-ciphers AES-256-GCM:AES-128-GCM:CHACHA20-POLY1305
verb 3
<ca>
EOF
  cat "$VPN_DIR/ca.crt"
  printf '</ca>\n<cert>\n'
  cat "$VPN_DIR/mac.crt"
  printf '</cert>\n<key>\n'
  cat "$VPN_DIR/mac.key"
  printf '</key>\n<tls-crypt>\n'
  cat "$VPN_DIR/tc.key"
  printf '</tls-crypt>\n'
} > "$PROFILE"
chown "$CLIENT_USER:$CLIENT_USER" "$PROFILE"
chmod 600 "$PROFILE"

systemctl daemon-reload
systemctl enable --now openvpn-home-firewall.service openvpn-server@home.service
echo "OpenVPN listening on TCP $PORT. Profile: $PROFILE"
echo "Configuration backup: $BACKUP_DIR"
echo "Forward router TCP $PORT to 192.168.1.237 TCP $PORT, then test from the Mac."
