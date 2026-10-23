import zipfile,re,sys,os
for f in sys.argv[1:]:
    z=zipfile.ZipFile(f)
    x=z.read('word/document.xml').decode()
    paras=re.findall(r'<w:p[ >].*?</w:p>',x,flags=re.S)
    out=[]
    for p in paras:
        t=''.join(re.findall(r'<w:t[^>]*>([^<]*)</w:t>',p))
        if t.strip(): out.append(t)
    imgs=[n for n in z.namelist() if n.startswith('word/media')]
    name=os.path.basename(f)+'.txt'
    open('/tmp/chap/'+name,'w').write('\n'.join(out))
    print(name,len(out),'paras',len(' '.join(out).split()),'words',imgs)
