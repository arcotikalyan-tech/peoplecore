-- PeopleCore · The live app server's addresses, so the office-network check-in rule judges direct calls by the address
-- the database saw (see 20261027000300_punch_trust). These are the Hostinger server's outgoing IPv4 and IPv6 addresses
-- (checked 27 Oct 2026). If the server moves, update this list, or web check-ins under that rule will be refused.

update public.platform_settings set trusted_proxy_ips = '{187.127.120.22,2a02:4780:5e:fa43::1}', updated_at = now();
