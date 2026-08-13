package main

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/flare-foundation/go-flare-common/pkg/logger"
)

const (
	proxyProbeDNSLimit     = 3 * time.Second
	proxyProbeConnectLimit = 3 * time.Second
	proxyProbeHTTPLimit    = 5 * time.Second
)

// probeProxyConnectivity diagnoses only the transport used by tee-node. It is
// deliberately non-fatal: a proxy may still be starting when this process is
// deployed. No headers, bodies, credentials, query strings, or environment
// values are logged.
func probeProxyConnectivity(rawProxyURL string) {
	u, err := url.Parse(rawProxyURL)
	if err != nil || u.Scheme == "" || u.Hostname() == "" {
		logger.Infof("proxy connectivity dns resolved_ips=[]")
		logger.Infof("proxy connectivity tcp connect=failure")
		logger.Infof("proxy connectivity http status=unavailable")
		return
	}

	host := u.Hostname()
	port := u.Port()
	if port == "" {
		if u.Scheme == "https" {
			port = "443"
		} else {
			port = "80"
		}
	}

	ctx, cancel := context.WithTimeout(context.Background(), proxyProbeDNSLimit)
	addrs, lookupErr := net.DefaultResolver.LookupIPAddr(ctx, host)
	cancel()
	ips := printableIPs(addrs)
	logger.Infof("proxy connectivity dns resolved_ips=%s", formatIPs(ips))
	if lookupErr != nil || len(ips) == 0 {
		logger.Infof("proxy connectivity tcp connect=failure")
		logger.Infof("proxy connectivity http status=unavailable")
		return
	}

	connected := false
	for _, ip := range ips {
		network := "tcp4"
		if strings.Contains(ip, ":") {
			network = "tcp6"
		}
		conn, dialErr := net.DialTimeout(network, net.JoinHostPort(ip, port), proxyProbeConnectLimit)
		if dialErr != nil {
			logger.Infof("proxy connectivity tcp ip=%s network=%s connect=failure", ip, network)
			continue
		}
		connected = true
		_ = conn.Close()
		logger.Infof("proxy connectivity tcp ip=%s network=%s connect=success", ip, network)
	}
	if !connected {
		logger.Infof("proxy connectivity http status=unavailable")
		return
	}

	healthURL := *u
	healthURL.User = nil
	healthURL.RawQuery = ""
	healthURL.Fragment = ""
	healthURL.Path = "/health"
	client := &http.Client{Timeout: proxyProbeHTTPLimit}
	resp, requestErr := client.Get(healthURL.String())
	if requestErr != nil {
		logger.Infof("proxy connectivity http status=unavailable")
		return
	}
	_ = resp.Body.Close()
	logger.Infof("proxy connectivity http status=%d", resp.StatusCode)
}

func printableIPs(addrs []net.IPAddr) []string {
	ips := make([]string, 0, len(addrs))
	seen := make(map[string]struct{}, len(addrs))
	for _, addr := range addrs {
		ip := addr.IP.String()
		if ip == "" {
			continue
		}
		if _, ok := seen[ip]; ok {
			continue
		}
		seen[ip] = struct{}{}
		ips = append(ips, ip)
	}
	sort.Strings(ips)
	return ips
}

func formatIPs(ips []string) string {
	return fmt.Sprintf("[%s]", strings.Join(ips, ","))
}
