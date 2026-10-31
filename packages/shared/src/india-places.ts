import { STATES, type StateCode } from './statutory.ts';

/**
 * Countries, states and cities offered by address forms. Only India for now. Each state lists its larger cities and
 * district headquarters, not every town: forms let people type a city that isn't listed.
 */

export const COUNTRIES = ['India'] as const;

const CITIES: Record<StateCode, string> = {
  AN: 'Car Nicobar, Diglipur, Mayabunder, Port Blair, Rangat, Sri Vijaya Puram',
  AP: 'Adoni, Amalapuram, Amaravati, Anakapalli, Anantapuramu, Bapatla, Bhimavaram, Chilakaluripet, Chittoor, Dharmavaram, Eluru, Gudivada, Guntakal, Guntur, Hindupur, Kadapa, Kakinada, Kurnool, Machilipatnam, Madanapalle, Nandyal, Narasaraopet, Nellore, Ongole, Paderu, Parvathipuram, Proddatur, Puttaparthi, Rajamahendravaram, Rayachoti, Srikakulam, Tadepalligudem, Tenali, Tirupati, Vijayawada, Visakhapatnam, Vizianagaram',
  AR: 'Aalo, Bomdila, Changlang, Daporijo, Itanagar, Khonsa, Naharlagun, Namsai, Pasighat, Roing, Seppa, Tawang, Tezu, Ziro',
  AS: 'Barpeta, Bongaigaon, Dhubri, Dibrugarh, Diphu, Dispur, Goalpara, Golaghat, Guwahati, Haflong, Hailakandi, Hojai, Jorhat, Karimganj, Kokrajhar, Mangaldoi, Morigaon, Nagaon, Nalbari, North Lakhimpur, Silchar, Sivasagar, Tezpur, Tinsukia',
  BR: 'Araria, Arrah, Aurangabad, Banka, Begusarai, Bettiah, Bhabua, Bhagalpur, Bihar Sharif, Buxar, Chhapra, Darbhanga, Dehri, Gaya, Gopalganj, Hajipur, Jamui, Jehanabad, Katihar, Khagaria, Kishanganj, Lakhisarai, Madhepura, Madhubani, Motihari, Munger, Muzaffarpur, Nawada, Patna, Purnia, Saharsa, Samastipur, Sasaram, Sheikhpura, Sheohar, Sitamarhi, Siwan, Supaul',
  CH: 'Chandigarh',
  CG: 'Ambikapur, Balod, Baloda Bazar, Bemetara, Bhilai, Bijapur, Bilaspur, Champa, Dantewada, Dhamtari, Durg, Gariaband, Jagdalpur, Janjgir, Jashpur, Kanker, Kawardha, Kondagaon, Korba, Mahasamund, Mungeli, Nava Raipur, Raigarh, Raipur, Rajnandgaon, Sukma, Surajpur',
  DH: 'Daman, Diu, Silvassa',
  DL: 'Delhi, New Delhi',
  GA: 'Bicholim, Canacona, Curchorem, Mapusa, Margao, Panaji, Pernem, Ponda, Quepem, Sanguem, Valpoi, Vasco da Gama',
  GJ: 'Ahmedabad, Ahwa, Amreli, Anand, Ankleshwar, Bharuch, Bhavnagar, Bhuj, Botad, Chhota Udaipur, Dahod, Deesa, Gandhidham, Gandhinagar, Godhra, Himmatnagar, Jamnagar, Junagadh, Kalol, Khambhalia, Lunawada, Mehsana, Modasa, Morbi, Nadiad, Navsari, Palanpur, Patan, Porbandar, Rajkot, Rajpipla, Surat, Surendranagar, Vadodara, Valsad, Vapi, Veraval, Vyara',
  HR: 'Ambala, Bahadurgarh, Bhiwani, Charkhi Dadri, Faridabad, Fatehabad, Gurugram, Hisar, Jhajjar, Jind, Kaithal, Karnal, Kurukshetra, Manesar, Narnaul, Nuh, Palwal, Panchkula, Panipat, Rewari, Rohtak, Sirsa, Sonipat, Yamunanagar',
  HP: 'Baddi, Bilaspur, Chamba, Dharamshala, Hamirpur, Kangra, Keylong, Kullu, Manali, Mandi, Nahan, Nalagarh, Palampur, Parwanoo, Reckong Peo, Shimla, Solan, Sundernagar, Una',
  JK: 'Anantnag, Bandipora, Baramulla, Budgam, Doda, Ganderbal, Jammu, Katra, Kathua, Kishtwar, Kulgam, Kupwara, Poonch, Pulwama, Rajouri, Ramban, Reasi, Samba, Shopian, Sopore, Srinagar, Udhampur',
  JH: 'Adityapur, Bokaro Steel City, Chaibasa, Chatra, Deoghar, Dhanbad, Dumka, Garhwa, Giridih, Godda, Gumla, Hazaribagh, Jamshedpur, Jamtara, Khunti, Koderma, Latehar, Lohardaga, Medininagar, Pakur, Phusro, Ramgarh, Ranchi, Sahibganj, Seraikela, Simdega',
  KA: 'Bagalkot, Ballari, Belagavi, Bengaluru, Bhadravati, Bidar, Chamarajanagar, Chikkaballapur, Chikkamagaluru, Chitradurga, Davanagere, Devanahalli, Dharwad, Doddaballapur, Gadag, Gokak, Hassan, Haveri, Hosapete, Hoskote, Hubballi, Kalaburagi, Karwar, Kolar, Koppal, Madikeri, Mandya, Mangaluru, Manipal, Mysuru, Nelamangala, Puttur, Raichur, Ramanagara, Shivamogga, Sirsi, Tumakuru, Udupi, Vijayapura, Yadgir',
  KL: 'Alappuzha, Aluva, Attingal, Changanassery, Ernakulam, Guruvayur, Idukki, Kalpetta, Kannur, Kasaragod, Kayamkulam, Kochi, Kollam, Kottayam, Kozhikode, Malappuram, Manjeri, Muvattupuzha, Neyyattinkara, Palakkad, Pathanamthitta, Payyanur, Perumbavoor, Ponnani, Thalassery, Thiruvananthapuram, Thodupuzha, Thrissur, Tirur, Vadakara',
  LA: 'Kargil, Leh',
  LD: 'Agatti, Amini, Andrott, Kavaratti, Minicoy',
  MP: 'Agar, Alirajpur, Anuppur, Ashoknagar, Balaghat, Barwani, Betul, Bhind, Bhopal, Burhanpur, Chhatarpur, Chhindwara, Damoh, Datia, Dewas, Dhar, Dindori, Guna, Gwalior, Harda, Indore, Itarsi, Jabalpur, Jhabua, Katni, Khandwa, Khargone, Maihar, Mandla, Mandsaur, Morena, Nagda, Narmadapuram, Narsinghpur, Neemuch, Niwari, Panna, Pithampur, Raisen, Rajgarh, Ratlam, Rewa, Sagar, Satna, Sehore, Seoni, Shahdol, Shajapur, Sheopur, Shivpuri, Sidhi, Singrauli, Tikamgarh, Ujjain, Umaria, Vidisha',
  MH: 'Ahilyanagar, Akola, Alibag, Ambernath, Amravati, Badlapur, Baramati, Beed, Bhandara, Bhiwandi, Buldhana, Chakan, Chandrapur, Chhatrapati Sambhajinagar, Dharashiv, Dhule, Dombivli, Gadchiroli, Gondia, Hingoli, Ichalkaranji, Jalgaon, Jalna, Kalyan, Karad, Kolhapur, Latur, Lonavala, Malegaon, Mira-Bhayandar, Mumbai, Nagpur, Nanded, Nandurbar, Nashik, Navi Mumbai, Palghar, Panvel, Parbhani, Pimpri-Chinchwad, Pune, Ratnagiri, Sangli, Satara, Sindhudurg, Solapur, Thane, Ulhasnagar, Vasai-Virar, Wardha, Washim, Yavatmal',
  MN: 'Bishnupur, Chandel, Churachandpur, Imphal, Jiribam, Kakching, Moreh, Senapati, Tamenglong, Thoubal, Ukhrul',
  ML: 'Ampati, Baghmara, Jowai, Khliehriat, Mairang, Mawkyrwat, Nongpoh, Nongstoin, Resubelpara, Shillong, Tura, Williamnagar',
  MZ: 'Aizawl, Champhai, Hnahthial, Khawzawl, Kolasib, Lawngtlai, Lunglei, Mamit, Saiha, Saitual, Serchhip',
  NL: 'Chumoukedima, Dimapur, Kiphire, Kohima, Longleng, Mokokchung, Mon, Peren, Phek, Tuensang, Wokha, Zunheboto',
  OD: 'Angul, Balasore, Bargarh, Baripada, Berhampur, Bhadrak, Bhawanipatna, Bhubaneswar, Bolangir, Boudh, Cuttack, Deogarh, Dhenkanal, Gunupur, Jagatsinghpur, Jajpur, Jeypore, Jharsuguda, Kendrapara, Keonjhar, Khordha, Koraput, Malkangiri, Nabarangpur, Nayagarh, Nuapada, Paradip, Paralakhemundi, Phulbani, Puri, Rayagada, Rourkela, Sambalpur, Sonepur, Sundargarh, Talcher',
  PY: 'Karaikal, Mahe, Puducherry, Yanam',
  PB: 'Abohar, Amritsar, Barnala, Batala, Bathinda, Faridkot, Fatehgarh Sahib, Fazilka, Firozpur, Gurdaspur, Hoshiarpur, Jalandhar, Kapurthala, Khanna, Kharar, Ludhiana, Malerkotla, Mansa, Moga, Mohali, Muktsar, Nawanshahr, Pathankot, Patiala, Phagwara, Rajpura, Rupnagar, Sangrur, Tarn Taran, Zirakpur',
  RJ: 'Ajmer, Alwar, Banswara, Baran, Barmer, Beawar, Bharatpur, Bhilwara, Bhiwadi, Bikaner, Bundi, Chittorgarh, Churu, Dausa, Dholpur, Dungarpur, Gangapur City, Hanumangarh, Jaipur, Jaisalmer, Jalore, Jhalawar, Jhunjhunu, Jodhpur, Karauli, Kishangarh, Kota, Mount Abu, Nagaur, Neemrana, Pali, Pratapgarh, Rajsamand, Sawai Madhopur, Sikar, Sirohi, Sri Ganganagar, Tonk, Udaipur',
  SK: 'Gangtok, Gyalshing, Jorethang, Mangan, Namchi, Pakyong, Rangpo, Singtam, Soreng',
  TN: 'Ariyalur, Avadi, Chengalpattu, Chennai, Coimbatore, Cuddalore, Dharmapuri, Dindigul, Erode, Hosur, Kallakurichi, Kancheepuram, Karur, Krishnagiri, Kumbakonam, Madurai, Mayiladuthurai, Nagapattinam, Nagercoil, Namakkal, Neyveli, Perambalur, Pollachi, Pudukkottai, Rajapalayam, Ramanathapuram, Ranipet, Salem, Sivaganga, Sivakasi, Sriperumbudur, Tambaram, Tenkasi, Thanjavur, Theni, Thoothukudi, Tiruchirappalli, Tirunelveli, Tirupathur, Tiruppur, Tiruvallur, Tiruvannamalai, Tiruvarur, Udhagamandalam, Vellore, Viluppuram, Virudhunagar',
  TS: 'Adilabad, Asifabad, Bhongir, Bhupalpally, Gadwal, Hanamkonda, Hyderabad, Jagtial, Jangaon, Kamareddy, Karimnagar, Khammam, Kothagudem, Mahabubabad, Mahbubnagar, Mancherial, Medak, Medchal, Miryalaguda, Mulugu, Nagarkurnool, Nalgonda, Narayanpet, Nirmal, Nizamabad, Peddapalli, Ramagundam, Sangareddy, Secunderabad, Shamshabad, Siddipet, Sircilla, Suryapet, Vikarabad, Wanaparthy, Warangal',
  TR: 'Agartala, Ambassa, Belonia, Bishalgarh, Dharmanagar, Kailashahar, Kamalpur, Khowai, Melaghar, Sabroom, Santirbazar, Sonamura, Teliamura, Udaipur',
  UP: 'Agra, Aligarh, Amethi, Amroha, Auraiya, Ayodhya, Azamgarh, Badaun, Baghpat, Bahraich, Ballia, Balrampur, Banda, Barabanki, Bareilly, Basti, Bhadohi, Bijnor, Bulandshahr, Chandauli, Chitrakoot, Deoria, Etah, Etawah, Farrukhabad, Fatehpur, Firozabad, Ghaziabad, Ghazipur, Gonda, Gorakhpur, Greater Noida, Hamirpur, Hapur, Hardoi, Hathras, Jaunpur, Jhansi, Kannauj, Kanpur, Kasganj, Kaushambi, Khurja, Kushinagar, Lakhimpur, Lalitpur, Lucknow, Maharajganj, Mahoba, Mainpuri, Mathura, Mau, Meerut, Mirzapur, Modinagar, Moradabad, Muzaffarnagar, Noida, Orai, Pilibhit, Prayagraj, Pratapgarh, Raebareli, Rampur, Robertsganj, Saharanpur, Sambhal, Shahjahanpur, Shamli, Shravasti, Siddharthnagar, Sitapur, Sultanpur, Unnao, Varanasi, Vrindavan',
  UK: 'Almora, Bageshwar, Champawat, Dehradun, Gopeshwar, Haldwani, Haridwar, Jaspur, Kashipur, Khatima, Kotdwar, Mussoorie, Nainital, New Tehri, Pauri, Pithoragarh, Ramnagar, Rishikesh, Roorkee, Rudraprayag, Rudrapur, Sitarganj, Srinagar, Uttarkashi',
  WB: 'Alipurduar, Asansol, Baharampur, Balurghat, Bankura, Barasat, Bardhaman, Barrackpore, Bidhannagar, Bolpur, Bongaon, Chinsurah, Contai, Cooch Behar, Darjeeling, Diamond Harbour, Durgapur, English Bazar, Habra, Haldia, Howrah, Jalpaiguri, Jhargram, Kalimpong, Kalyani, Kharagpur, Kolkata, Krishnanagar, Medinipur, New Town, Purulia, Raiganj, Serampore, Siliguri, Suri, Tamluk',
};

/** States and union territories by name, for a dropdown. */
export const INDIA_STATES = (Object.keys(STATES) as StateCode[])
  .map((code) => ({ code, name: STATES[code].name }))
  .sort((a, b) => a.name.localeCompare(b.name));

const sorted = new Map<StateCode, readonly string[]>();
/** The listed cities of a state, A to Z. */
export function citiesOf(code: StateCode): readonly string[] {
  let list = sorted.get(code);
  if (!list) sorted.set(code, (list = CITIES[code].split(', ').sort((a, b) => a.localeCompare(b))));
  return list;
}

/** A state's name from its code; anything else comes back as it is. */
export const stateName = (value: string | null | undefined) => (value && Object.hasOwn(STATES, value) ? STATES[value as StateCode].name : value);

/** A state from its code or name as people type it ("ka", "Karnataka"), or null. */
export function findState(value: string | null | undefined): StateCode | null {
  const v = value?.trim().toLowerCase();
  if (!v) return null;
  return INDIA_STATES.find((s) => s.code.toLowerCase() === v || s.name.toLowerCase() === v)?.code ?? null;
}
