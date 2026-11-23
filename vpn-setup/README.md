# Mac to home VPN over TCP

The installer adds OpenVPN on TCP 443 without changing WireGuard, SSH, or Docker rules. TCP 443 is free on the server as checked on November 2, 2026. It does not establish that the router forwards it or that the school permits it.

## Server setup

On `aiden-server`, run:

```bash
cd /home/aidensmith/obaffle
sudo bash vpn-setup/install-openvpn-home.sh
```

The script asks for your sudo password in your terminal. It creates private CA, server, and Mac client keys under `/etc/openvpn/home`, and a Mac import profile at `/home/aidensmith/Home-Internet-TCP.ovpn` (mode 600). Do not commit or share that profile. It backs up current UFW, WireGuard, iptables, and forwarding state under `/root/openvpn-home-backup-...`. If TCP 443 is occupied at install time, the script stops before changing anything. To select another port, use `sudo PORT=8443 bash vpn-setup/install-openvpn-home.sh` and forward that same TCP port.

In the home router, add a **TCP** port forward: external port **443** to **192.168.1.237**, internal port **443**. Keep the existing TCP 2222 and UDP 51820 forwards. If using another port, substitute it in both fields. Reserve 192.168.1.237 for this server in DHCP if it is not already reserved.

Check the service after installation:

```bash
sudo systemctl status openvpn-server@home openvpn-home-firewall --no-pager
sudo ss -ltnp '( sport = :443 )'
sudo journalctl -u openvpn-server@home -n 40 --no-pager
```

## Mac setup

From the Mac, copy the profile over the existing SSH connection:

```bash
scp -P 2222 aidensmith@45.36.195.136:/home/aidensmith/Home-Internet-TCP.ovpn ~/Downloads/
```

Install an OpenVPN client that supports `.ovpn` import, such as OpenVPN Connect or Tunnelblick. Import `~/Downloads/Home-Internet-TCP.ovpn`, then connect. Store the profile privately; it contains the Mac client key. Disconnect the WireGuard Home-Internet profile when testing the TCP profile.

The profile routes IPv4 and IPv6 through home and supplies Cloudflare IPv4 and IPv6 DNS. First test from a non-home connection, then repeat on school Wi-Fi. On the Mac while connected:

```bash
curl -4 https://ifconfig.me
curl -6 https://ifconfig.me
dig example.com
scutil --dns
netstat -rn -f inet
netstat -rn -f inet6
```

Compare both public IP results with the server's public IPv4 and IPv6. `curl -6` must succeed through the tunnel; if it does not, disconnect and investigate before using the profile for traffic you expect to stay on home internet. `scutil --dns` should show the pushed DNS servers on the active VPN resolver. Test Apple Music and iCloud after these checks. Handoff and iPhone Mirroring depend on local discovery and may need separate work.

For server-side connection checks:

```bash
sudo journalctl -u openvpn-server@home -f
sudo tcpdump -ni enp3s0 tcp port 443
```

If the Mac cannot establish a TCP connection at school, check the router forward and test from another outside network. A successful outside test with no school traffic reaching the server indicates school-side filtering. TCP 443 is not guaranteed to pass school filtering.
