import argparse
import json
from pathlib import Path
import cv2
import numpy as np
import re
import zxingcpp

cv2.setNumThreads(1)

def page_code(gray, layout):
    x = layout['markers'][0]['x'] * layout['width'] + 23
    y = layout['markers'][0]['y'] * layout['height'] - 5
    return ''.join('1' if np.mean(gray[round(y)+3:round(y)+7,round(x+i*8)+1:round(x+i*8)+5] < 150) > .6 else '0' for i in range(46))

def align(image, layout):
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    _, binary = cv2.threshold(gray, 95, 255, cv2.THRESH_BINARY_INV)
    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    h, w = gray.shape
    candidates = []
    for contour in contours:
        x, y, cw, ch = cv2.boundingRect(contour)
        if cw < w*.004 or ch < h*.003 or cw > w*.05 or ch > h*.04:
            continue
        hull = cv2.convexHull(contour)
        hull_area = cv2.contourArea(hull)
        approximation = cv2.approxPolyDP(contour,.06*cv2.arcLength(contour,True),True)
        if not .55 < cw/ch < 1.8 or len(approximation) != 4 or hull_area <= 0 or cv2.contourArea(contour)/hull_area < .85:
            continue
        candidates.append((x+cw/2, y+ch/2))
    if len(candidates) < 4:
        raise ValueError("REGISTRATION_MARKS_MISSING: 请保证四个定位点均清晰且未被裁掉")
    # Convex hull corners resist printed text and filled student-number cells.
    points = np.asarray(candidates, np.float32)
    corners = np.asarray([points[np.argmin(points.sum(axis=1))], points[np.argmax(points[:,0]-points[:,1])], points[np.argmax(points.sum(axis=1))], points[np.argmin(points[:,0]-points[:,1])]], np.float32)
    if len(set(map(tuple,corners))) != 4 or not cv2.isContourConvex(corners) or abs(cv2.contourArea(corners)) < w*h*.35:
        raise ValueError("REGISTRATION_MARKS_INVALID: 四个定位点无法形成有效页面")
    target = np.asarray([[m['x']*layout['width'],m['y']*layout['height']] for m in layout['markers']],np.float32)
    # Markers are stored in TL, TR, BR, BL order and checked before invoking Python.
    possibilities = []
    for orientation in range(4):
        source = np.roll(corners,orientation,axis=0)
        transform = cv2.getPerspectiveTransform(source,target)
        corrected = cv2.warpPerspective(image,transform,(layout['width'],layout['height']),flags=cv2.INTER_CUBIC,borderValue=(255,255,255))
        gray = cv2.cvtColor(corrected,cv2.COLOR_BGR2GRAY)
        _, evidence = student_omr(gray,layout)
        code = page_code(gray, layout)
        guard_error = int(not code.startswith('101') or not code.endswith('110'))
        possibilities.append((guard_error,len(evidence['ambiguousColumns']),orientation,corrected,source,transform))
    _, _, orientation, corrected, source, transform = min(possibilities,key=lambda p:(p[0],p[1],p[2]))
    return corrected, {'corrected':True,'orientationQuarterTurns':orientation,'sourceCorners':source.tolist(),'transform':transform.tolist(),'width':layout['width'],'height':layout['height']}

def darkness(gray, x, y, radius):
    # Ignore rectangle outlines and labels around the edge; central fill survives pencil variance.
    mask = np.zeros(gray.shape,np.uint8)
    cv2.circle(mask,(round(x),round(y)),max(2,round(radius*.7)),255,-1)
    values = gray[mask>0]
    return float(np.mean(values < 150)) if values.size else 0.0

def student_omr(gray, layout):
    n = layout['studentNumber']
    result, errors, evidence = '', [], []
    for column in range(n['digits']):
        scores = [darkness(gray,(n['x']+column*n['cellWidth'])*layout['width'],(n['y']+value*n['cellHeight'])*layout['height'],5) for value in range(10)]
        ranked = sorted(range(10),key=lambda value:scores[value],reverse=True)
        value, second = ranked[:2]
        ambiguous = scores[value] < .7 or scores[second] > .6 or scores[value]-scores[second] < .25
        result += '?' if ambiguous else str(value)
        if ambiguous: errors.append(column)
        evidence.append(scores)
    return None if errors else result, {'columns':evidence,'ambiguousColumns':errors}

def student_barcode(gray, layout):
    n = layout['studentNumber']
    left = round((n['x'] - n['cellWidth']/2) * layout['width'])
    top = round(n['y'] * layout['height'] - 22)
    width = round(n['digits'] * n['cellWidth'] * layout['width'])
    area = gray[max(0,top):top+112, max(0,left):left+width]
    results = zxingcpp.read_barcodes(area, formats=zxingcpp.BarcodeFormat.Code128 | zxingcpp.BarcodeFormat.Code39 | zxingcpp.BarcodeFormat.ITF)
    numbers = sorted(set(result.text for result in results if re.fullmatch(r'[0-9]{6}', result.text)))
    return numbers[0] if len(numbers) == 1 else None, {'mode':'BARCODE','candidates':numbers,'needsReview':len(numbers) != 1}

def validate_box(box):
    values = [box[key] for key in ['x','y','width','height']]
    if not all(isinstance(value,(float,int)) and np.isfinite(value) for value in values): raise ValueError('Invalid crop coordinates')
    x,y,w,h = values
    if x < 0 or y < 0 or w <= 0 or h <= 0 or x+w > 1.00001 or y+h > 1.00001: raise ValueError('Crop outside image')

def crop(image, region, out, index):
    validate_box(region)
    h,w = image.shape[:2]
    x,y,rw,rh = region['x'],region['y'],region['width'],region['height']
    left,top,right,bottom = round(x*w),round(y*h),round((x+rw)*w),round((y+rh)*h)
    if right <= left or bottom <= top: raise ValueError('Crop has no pixels')
    path = out/f'answer-{index+1}.png'
    if not cv2.imwrite(str(path),image[top:bottom,left:right]): raise OSError('Could not write crop')
    return str(path)

def scan(image, layout, page, output, expected_code=None, page_codes=None):
    corrected, metadata = align(image,layout)
    gray = cv2.cvtColor(corrected,cv2.COLOR_BGR2GRAY)
    actual_code = page_code(gray, layout)
    if page_codes:
        if actual_code in page_codes:
            page = page_codes.index(actual_code) + 1
        else:
            # Reuse the same strict template/code validation for unordered batch uploads.
            expected_code = page_codes[0]
    if expected_code and actual_code != expected_code:
        if not actual_code.startswith('101') or not actual_code.endswith('110'): raise ValueError('CARD_PAGE_CODE_MISSING: 页面识别码不清晰，请按模板重新打印')
        if actual_code[3:35] != expected_code[3:35]: raise ValueError('CARD_TEMPLATE_MISMATCH: 答题卡不属于所选模板')
        raise ValueError('CARD_PAGE_ORDER: 答题卡页码与上传顺序不符，请按每位学生的页码排序')
    metadata['pageCode'] = actual_code
    metadata['page'] = page
    header_mode = layout.get('headerMode', 'EVERY_PAGE')
    has_header = header_mode == 'EVERY_PAGE' or (header_mode == 'ODD_PAGES' and page % 2 == 1) or (header_mode == 'FIRST_PAGE' and page == 1)
    if has_header:
        student, evidence = student_barcode(gray,layout) if layout['studentNumber'].get('mode') == 'BARCODE' else student_omr(gray,layout)
    else:
        student, evidence = None, {'skipped':True,'reason':'HEADER_HIDDEN'}
    metadata['studentNumber'] = evidence
    answers, review = [], has_header and student is None
    for region in layout['regions']:
        if region['page'] != page: continue
        path = crop(corrected,region,output,len(answers))
        selected, scores = [], {}
        ambiguous = False
        if region['kind'] == 'CHOICE':
            for index,label in enumerate(region.get('options',[])):
                modern = layout.get('omrVersion') == 2
                columns = max(1, int((region['width']*layout['width']-37)//32))
                x = region['x']*layout['width'] + (54+(index%columns)*32 if modern else 85+index*46)
                rows = (len(region.get('options', [])) + columns - 1) // columns
                top = min(44, region['height']*layout['height'] - 8 - max(0, rows-1)*22)
                y = region['y']*layout['height'] + (top+(index//columns)*22 if modern else 29)
                score = darkness(gray,x,y,7)
                scores[label] = score
                if score > .65: selected.append(label)
                elif score > .3: ambiguous = True
            if not region.get('multiple',False) and len(selected) != 1: ambiguous = True
            if not selected: ambiguous = True
        review = review or ambiguous
        answers.append({'itemId':region['itemId'],'text':','.join(selected),'images':[path],'box':{key:region[key] for key in ['page','x','y','width','height']},'omr':{'scores':scores,'needsReview':ambiguous}})
    corrected_path = output/'corrected.png'
    cv2.imwrite(str(corrected_path),corrected)
    metadata['correctedFile'] = str(corrected_path)
    return {'studentNumber':student,'answers':answers,'alignment':metadata,'needsReview':review}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--input',required=True)
    parser.add_argument('--config',required=True)
    parser.add_argument('--output',required=True)
    args = parser.parse_args()
    config = json.loads(Path(args.config).read_text())
    image = cv2.imread(args.input)
    if image is None: raise ValueError('Could not decode scan image')
    if image.shape[0]*image.shape[1] > 80_000_000: raise ValueError('Scan image too large')
    out = Path(args.output); out.mkdir(parents=True,exist_ok=True)
    if config['mode'] == 'card':
        result = scan(image,config['layout'],config['page'],out,config.get('pageCode'),config.get('pageCodes'))
    else:
        result = {'studentNumber':None,'answers':[{'itemId':r['itemId'],'text':'','images':[crop(image,r,out,i)],'box':{key:r[key] for key in ['page','x','y','width','height']}} for i,r in enumerate(config['regions'])],'alignment':{'corrected':False,'manual':True},'needsReview':False}
    print(json.dumps(result,allow_nan=False))

if __name__ == '__main__': main()
