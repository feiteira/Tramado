import json, base64, hashlib, hmac, sys
p = {"v":1,"f":"tramado-geznkyujw4ofedwinfcmzl2rim","l":"Teoria Geral do Direito Civil","s":"TGDC","c":"#3e63dd","i":"scale",
     "lt":"Prof. Menezes","tm":"2026/27 · S1","lg":"pt-PT","m":"k3q7mzx2v4hbtnw5r6yjc2aefg","n":"Ana Ribeiro",
     "d":[{"id":"AB4Z76WGA7E7XY6YXM3ZPCLW473TRYRB5Q6KTOC53UHT4S232ZWB42Q2",
           "a":["tcp://192.168.1.20:22117","relay://95.216.157.10:22067/?id=NZRTFEN-2BDQUHB-QMGXH7S-5R3WWMU-NQT3OMK-5OYCJDY-IWQHG6C-2JXUSQX","tcp://85.243.10.7:22117"]},
          {"id":"TKBNV236HQ5HVUDM667CHDELE5MVVW4HTSN27PQJFWFVGLDA34XDXLAT",
           "a":["tcp://192.168.1.31:22100","relay://51.15.9.21:22067/?id=X3JRS4J-RKOMMTP-AZVFRGC-YLSD4MM-TRRUSLA-GSZ3TVO-5C2EYXV-6RIHGAQ"]},
          {"id":"LGTQI2NC7CZ54ULP7HIBQVR4TCWOYY67AJFSXWTCG5QLJA5Q4X4KTTQO","a":["tcp://10.20.0.11:22105"]}],
     "t":1793721438}
j = json.dumps(p, ensure_ascii=False, separators=(",",":")).encode()
b = base64.urlsafe_b64encode(j).decode().rstrip("=")
code = "tri1_"+b
print("json bytes", len(j)); print("code chars", len(code)); print("link chars", len("tramado://join/"+code))
print(code[:120]+"…")
# minimal
q={"v":1,"f":"tramado-geznkyujw4ofedwinfcmzl2rim","l":"TGDC","c":"#3e63dd","i":"scale","m":"k3q7mzx2v4hbtnw5r6yjc2aefg","n":"Ana","d":[{"id":"AB4Z76WGA7E7XY6YXM3ZPCLW473TRYRB5Q6KTOC53UHT4S232ZWB42Q2","a":[]}],"t":1793721438}
jq_=json.dumps(q,separators=(",",":")).encode(); print("minimal code chars", len("tri1_"+base64.urlsafe_b64encode(jq_).decode().rstrip("=")))
# pair proof example
k = base64.b32decode("MFRGGZDFMZTWQ2LKNNWG23TPOA======")  # 'abcdefghijklmnop' 16 bytes
msg = b"tramado-pair-v1|TKBNV23-6HQ5HVU-DM667CH-DELE5MV-VW4HTSN-27PQJFW-FVGLDA3-4XDXLAT|k3q7mzx2v4hbtnw5r6yjc2aefg"
mac = base64.b32encode(hmac.new(k,msg,hashlib.sha256).digest()).decode().rstrip("=").lower()[:26]
print("mac", mac)
print("dashless len", len("AB4Z76W-GA7E7XY-6YXM3ZP-CLW473T-RYRB5Q6-KTOC53U-HT4S232-ZWB42Q2".replace("-","")))
